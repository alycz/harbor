import { type VenueQuote, VenueRefusal } from '@harbor/adapters/venue';
import { AmountError, MAX_U128_RAW, parseDecimalAmount, rawFromText, rawToText } from '@harbor/domain/amount';
import type { AssetRef } from '@harbor/domain/asset';
import { AppError } from '@harbor/domain/errors';
import { type Decision, evaluate, type Rule } from '@harbor/policy/engine';

import {
  basePlanView,
  canonicalJson,
  type ExecutionDeps,
  type IntentRow,
  insertIntent,
  insertQuote,
  logFailure,
  type PlanRow,
  type QuoteRow,
  rawAmount,
  sha256Hex,
} from './store.ts';

/** Applied to every quote until a signed policy sets its own; shown in the review the user approves. */
const SLIPPAGE_BPS = 50;
const QUOTE_MAX_AGE_MS = 30_000;
const PRICE_IMPACT_WARNING_BPS = 100;

export async function createSwapIntent(
  deps: ExecutionDeps,
  input: { sell: string; buy: string; amount: string; source: 'chat' | 'form' },
) {
  if (input.sell === input.buy) throw new AppError('INVALID_REQUEST', 'Choose two different assets to swap.');
  const sell = resolve(deps, input.sell);
  const buy = resolve(deps, input.buy);
  let raw: bigint;
  try {
    raw = parseDecimalAmount(input.amount, sell.decimals, MAX_U128_RAW);
  } catch (error) {
    throw new AppError('INVALID_REQUEST', error instanceof AmountError ? error.message : 'Enter a valid amount.');
  }
  if (raw === 0n) throw new AppError('INVALID_REQUEST', 'Enter an amount above zero.');
  const row: IntentRow = {
    id: crypto.randomUUID(),
    network: deps.config.network,
    kind: 'swap',
    sell_asset: sell.canonicalId,
    buy_asset: buy.canonicalId,
    sell_amount_raw: rawToText(raw),
    source: input.source,
    created_at_ms: deps.now(),
  };
  await insertIntent(deps, row);
  return swapIntentView(deps, row);
}

/** Gets a fresh quote for an intent from this network's swap venue. */
export async function compareSwap(deps: ExecutionDeps, intent: IntentRow) {
  if (!deps.venue) throw new AppError('UNAVAILABLE', 'No swap venue is configured on this server.');
  const sell = assetOf(deps, intent.sell_asset);
  const buy = assetOf(deps, intent.buy_asset);
  let quote: VenueQuote;
  try {
    quote = await deps.venue.quote({
      network: intent.network,
      sell,
      buy,
      amountIn: rawFromText(intent.sell_amount_raw),
      slippageBps: SLIPPAGE_BPS,
    });
  } catch (error) {
    if (error instanceof VenueRefusal) throw new AppError('UNAVAILABLE', error.message);
    logFailure('quote', error);
    throw new AppError('UNAVAILABLE', 'The swap venue could not quote this right now. Try again shortly.');
  }
  const observed = deps.now();
  const row: QuoteRow = {
    id: crypto.randomUUID(),
    intent_id: intent.id,
    venue: deps.venue.id,
    slippage_bps: SLIPPAGE_BPS,
    amount_in_raw: rawToText(quote.amountIn),
    amount_out_raw: rawToText(quote.amountOut),
    min_out_raw: rawToText(quote.minAmountOut),
    price_impact_bps: quote.priceImpactBps,
    protocols: JSON.stringify(quote.protocols),
    provider_quote: JSON.stringify(quote.raw, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    observed_at_ms: observed,
    expires_at_ms: observed + QUOTE_MAX_AGE_MS,
  };
  await insertQuote(deps, row);
  const view = swapQuoteView(deps, row, intent);
  return { quotes: [view], selectedQuoteId: view.id };
}

interface SwapPlanFacts {
  nowMs: number;
  quoteExpiresAtMs: number;
  amountOut: bigint;
  minOut: bigint;
  priceImpactBps: number | null;
  harborFeeBps: number;
}

const SWAP_RULES: readonly Rule<SwapPlanFacts>[] = [
  {
    id: 'quote_fresh',
    severity: 'block',
    check: (facts) => ({
      pass: facts.nowMs < facts.quoteExpiresAtMs,
      code: 'QUOTE_EXPIRED',
      detail: 'The quote must still be valid. Get a new quote.',
    }),
  },
  {
    id: 'minimum_output',
    severity: 'block',
    check: (facts) => ({
      pass: facts.minOut > 0n && facts.minOut <= facts.amountOut,
      code: 'MIN_OUTPUT_INVALID',
      detail: 'The minimum you receive must be above zero and no more than the quoted output.',
    }),
  },
  {
    id: 'price_impact',
    severity: 'warn',
    check: (facts) =>
      facts.priceImpactBps === null
        ? { pass: false, code: 'PRICE_IMPACT_UNKNOWN', detail: 'The venue did not report price impact for this route.' }
        : {
            pass: facts.priceImpactBps < PRICE_IMPACT_WARNING_BPS,
            code: 'PRICE_IMPACT_HIGH',
            detail: `Price impact is ${(facts.priceImpactBps / 100).toFixed(2)}%, at or above the 1% warning level.`,
            facts: { priceImpactBps: String(facts.priceImpactBps) },
          },
  },
  {
    id: 'harbor_fee',
    severity: 'block',
    check: (facts) => ({
      pass: facts.harborFeeBps === 0,
      code: 'HARBOR_FEE_NOT_ZERO',
      detail: 'Harbor charges no execution fee.',
    }),
  },
];

/** The policy decision and the digest the user's approval binds, for a swap plan. */
export async function swapPlanPolicy(
  intent: IntentRow,
  quote: QuoteRow,
  accountId: string,
  now: number,
): Promise<{ decision: Decision; digest: string }> {
  const decision = evaluate(SWAP_RULES, {
    nowMs: now,
    quoteExpiresAtMs: quote.expires_at_ms,
    amountOut: rawFromText(quote.amount_out_raw),
    minOut: rawFromText(quote.min_out_raw),
    priceImpactBps: quote.price_impact_bps,
    harborFeeBps: 0,
  });
  const digest = await sha256Hex(
    canonicalJson({
      intentId: intent.id,
      quoteId: quote.id,
      network: intent.network,
      account: accountId,
      sell: intent.sell_asset,
      buy: intent.buy_asset,
      amountInRaw: quote.amount_in_raw,
      minOutRaw: quote.min_out_raw,
      slippageBps: quote.slippage_bps,
    }),
  );
  return { decision, digest };
}

export function swapIntentView(deps: ExecutionDeps, row: IntentRow) {
  const buy = assetOf(deps, row.buy_asset);
  return {
    id: row.id,
    network: row.network,
    kind: 'swap' as const,
    sell: rawAmount(assetOf(deps, row.sell_asset), row.sell_amount_raw),
    buy: { symbol: buy.symbol, canonicalId: buy.canonicalId },
    source: row.source,
    createdAt: new Date(row.created_at_ms).toISOString(),
  };
}

function swapQuoteView(deps: ExecutionDeps, row: QuoteRow, intent: IntentRow) {
  const sell = assetOf(deps, intent.sell_asset);
  const buy = assetOf(deps, intent.buy_asset);
  return {
    id: row.id,
    intentId: row.intent_id,
    venue: row.venue,
    sell: rawAmount(sell, row.amount_in_raw),
    expectedOut: rawAmount(buy, row.amount_out_raw),
    minimumOut: rawAmount(buy, row.min_out_raw),
    slippageBps: row.slippage_bps,
    priceImpactBps: row.price_impact_bps,
    protocols: JSON.parse(row.protocols) as string[],
    harborFeeBps: 0,
    observedAt: new Date(row.observed_at_ms).toISOString(),
    expiresAt: new Date(row.expires_at_ms).toISOString(),
  };
}

export function swapPlanView(deps: ExecutionDeps, row: PlanRow, intent: IntentRow, quote: QuoteRow) {
  return {
    ...basePlanView(row),
    kind: 'swap' as const,
    quote: swapQuoteView(deps, quote, intent),
  };
}

function resolve(deps: ExecutionDeps, symbol: string): AssetRef {
  const asset = deps.assets.bySymbol(symbol);
  if (!asset) throw new AppError('INVALID_REQUEST', `${symbol.slice(0, 16)} is not a supported asset on this network.`);
  return asset;
}

/** Stored intents name registry assets; one missing from the registry is a configuration fault. */
function assetOf(deps: ExecutionDeps, canonicalId: string): AssetRef {
  const asset = deps.assets.byId(canonicalId);
  if (!asset) throw new AppError('UNAVAILABLE', 'This request names an asset the server no longer supports.');
  return asset;
}
