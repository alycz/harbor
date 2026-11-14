import { type DepositQuote, type VenueQuote, VenueRefusal } from '@harbor/adapters/venue';
import { AmountError, MAX_U128_RAW, parseDecimalAmount, rawFromText, rawToText } from '@harbor/domain/amount';
import type { AssetRef } from '@harbor/domain/asset';
import { AppError } from '@harbor/domain/errors';
import { ChainReadFailed, depositTransaction, registrationTransaction, tokenContractOf } from '@harbor/near/chain';
import { type Decision, evaluate, type Rule } from '@harbor/policy/engine';
import { type Destination, isOwnAddress } from '@harbor/policy/policy';

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
/** How long the owner has to review an executable quote, at most. */
const EXECUTABLE_REVIEW_MS = 5 * 60_000;
/** An executable quote stops being usable this long before 1Click's own deadline. */
const DEADLINE_MARGIN_MS = 2 * 60_000;

export type Deposit = DepositQuote['deposit'];
const PRICE_IMPACT_WARNING_BPS = 100;

const RECIPIENT = /^[\x21-\x7e]{2,128}$/;

export async function createSwapIntent(
  deps: ExecutionDeps,
  input: { sell: string; buy: string; amount: string; source: IntentRow['source']; recipient?: string | undefined },
) {
  if (input.sell === input.buy) throw new AppError('INVALID_REQUEST', 'Choose two different assets to swap.');
  if (input.recipient !== undefined && !RECIPIENT.test(input.recipient)) {
    throw new AppError('INVALID_REQUEST', 'The recipient must be an address of visible characters.');
  }
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
    recipient: input.recipient ?? null,
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
  return { quotes: [view], selectedQuoteId: view.id, references: await referenceQuotes(deps, intent) };
}

/**
 * Prices from venues Harbor compares against but never executes on, such as Rhea for pairs on NEAR.
 * Best effort: a reference that cannot be had is left out, and never blocks a quote.
 */
async function referenceQuotes(deps: ExecutionDeps, intent: IntentRow) {
  const sell = assetOf(deps, intent.sell_asset);
  const buy = assetOf(deps, intent.buy_asset);
  const tokenIn = tokenContractOf(sell.canonicalId);
  const tokenOut = tokenContractOf(buy.canonicalId);
  if (!deps.reference || sell.chain !== 'near' || buy.chain !== 'near' || !tokenIn || !tokenOut) return [];
  const rhea = await deps.reference.quote({ tokenIn, tokenOut, amountIn: rawFromText(intent.sell_amount_raw) });
  if (!rhea) return [];
  return [
    {
      venue: rhea.venue,
      name: 'Rhea',
      expectedOut: rawAmount(buy, rawToText(rhea.amountOut)),
      hops: rhea.hops,
      executable: false,
    },
  ];
}

/**
 * The token registrations a swap needs before 1Click will quote it: the owner on the token sold, so a
 * refund can reach them, and a NEAR recipient on the token bought. Each is the transaction that adds it.
 */
export async function missingRegistrations(
  deps: ExecutionDeps,
  intent: IntentRow,
  account: string,
  recipient: Destination | null,
) {
  const needs: { tokenContract: string; account: string }[] = [];
  const sold = tokenContractOf(intent.sell_asset);
  if (sold) needs.push({ tokenContract: sold, account });
  const bought = tokenContractOf(intent.buy_asset);
  if (bought && recipient?.chain === 'near') needs.push({ tokenContract: bought, account: recipient.address });
  try {
    const missing = [];
    for (const need of needs) {
      if (await deps.chain.storageRegistered(need.tokenContract, need.account)) continue;
      missing.push(
        registrationTransaction(need.tokenContract, need.account, await deps.chain.storageMinimum(need.tokenContract)),
      );
    }
    return missing;
  } catch (error) {
    if (error instanceof ChainReadFailed) {
      throw new AppError('UNAVAILABLE', 'NEAR could not be read right now. Try again shortly.');
    }
    throw error;
  }
}

/**
 * An executable quote for exactly this owner and recipient: 1Click refunds to the owner's account and
 * delivers only to the recipient the plan checks. Recorded beside the intent like any quote.
 */
export async function executableQuote(
  deps: ExecutionDeps,
  intent: IntentRow,
  account: string,
  recipient: Destination,
): Promise<{ row: QuoteRow; deposit: Deposit }> {
  if (!deps.executor) throw new AppError('EXECUTION_DISABLED', 'Execution is turned off on this server.');
  let quote: DepositQuote;
  try {
    quote = await deps.executor.executableQuote({
      network: intent.network,
      sell: assetOf(deps, intent.sell_asset),
      buy: assetOf(deps, intent.buy_asset),
      amountIn: rawFromText(intent.sell_amount_raw),
      slippageBps: SLIPPAGE_BPS,
      refundTo: account,
      recipient: recipient.address,
    });
  } catch (error) {
    if (error instanceof VenueRefusal) throw new AppError('UNAVAILABLE', error.message);
    logFailure('executable_quote', error);
    throw new AppError('UNAVAILABLE', 'NEAR Intents could not prepare this swap right now. Try again shortly.');
  }
  const observed = deps.now();
  const row: QuoteRow = {
    id: crypto.randomUUID(),
    intent_id: intent.id,
    venue: deps.executor.id,
    slippage_bps: SLIPPAGE_BPS,
    amount_in_raw: rawToText(quote.amountIn),
    amount_out_raw: rawToText(quote.amountOut),
    min_out_raw: rawToText(quote.minAmountOut),
    price_impact_bps: quote.priceImpactBps,
    protocols: JSON.stringify(quote.protocols),
    provider_quote: JSON.stringify(quote.raw, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    observed_at_ms: observed,
    expires_at_ms: Math.min(observed + EXECUTABLE_REVIEW_MS, quote.deposit.deadlineMs - DEADLINE_MARGIN_MS),
  };
  await insertQuote(deps, row);
  return { row, deposit: quote.deposit };
}

interface SwapPlanFacts {
  nowMs: number;
  quoteExpiresAtMs: number;
  amountOut: bigint;
  minOut: bigint;
  priceImpactBps: number | null;
  harborFeeBps: number;
  /** Where the bought asset goes, or null when no own address on that chain is known. */
  recipient: Destination | null;
  buyChain: string;
  /** The owner's own addresses: their NEAR account and the destinations they signed. */
  own: readonly Destination[];
  sellChain: string;
}

/** The plan's own checks. A block here stops the plan for everyone; no approval can override it. */
const SWAP_RULES: readonly Rule<SwapPlanFacts>[] = [
  {
    id: 'origin_near',
    severity: 'block',
    check: (facts) => ({
      pass: facts.sellChain === 'near',
      code: 'ORIGIN_NOT_NEAR',
      detail: 'Harbor sends only from your NEAR account. Choose an asset held on NEAR to sell.',
    }),
  },
  {
    id: 'recipient_known',
    severity: 'block',
    check: (facts) => ({
      pass: facts.recipient !== null,
      code: 'RECIPIENT_MISSING',
      detail: `Add your own ${facts.buyChain} address to your policy to receive this there.`,
    }),
  },
  {
    id: 'destination_own',
    severity: 'block',
    check: (facts) => ({
      pass: facts.recipient === null || isOwnAddress(facts.own, facts.recipient),
      code: 'DESTINATION_NOT_OWN',
      detail: facts.recipient
        ? `${facts.recipient.address} is not one of your addresses. Harbor only delivers to addresses you signed.`
        : 'Harbor only delivers to addresses you signed.',
      ...(facts.recipient ? { facts: { recipient: facts.recipient.address, chain: facts.recipient.chain } } : {}),
    }),
  },
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

/** The plan's own decision and the digest the user's approval binds, for a swap plan. */
export async function swapPlanPolicy(
  deps: ExecutionDeps,
  intent: IntentRow,
  quote: QuoteRow,
  accountId: string,
  now: number,
  destination: { recipient: Destination | null; own: readonly Destination[]; deposit: Deposit | null },
): Promise<{ decision: Decision; digest: string }> {
  const decision = evaluate(SWAP_RULES, {
    nowMs: now,
    quoteExpiresAtMs: quote.expires_at_ms,
    amountOut: rawFromText(quote.amount_out_raw),
    minOut: rawFromText(quote.min_out_raw),
    priceImpactBps: quote.price_impact_bps,
    harborFeeBps: 0,
    recipient: destination.recipient,
    buyChain: assetOf(deps, intent.buy_asset).chain,
    own: destination.own,
    sellChain: assetOf(deps, intent.sell_asset).chain,
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
      recipient: destination.recipient?.address ?? '',
      recipientChain: destination.recipient?.chain ?? '',
      refundTo: accountId,
      depositOriginChain: destination.deposit?.originChain ?? assetOf(deps, intent.sell_asset).chain,
      depositAddress: destination.deposit?.address ?? '',
      depositMemo: destination.deposit?.memo ?? '',
      quoteHash: destination.deposit?.quoteHash ?? '',
      depositDeadlineMs: destination.deposit?.deadlineMs ?? 0,
    }),
  );
  return { decision, digest };
}

/**
 * Where a swap delivers: the address asked for, or else the owner's own address on the bought
 * asset's chain (their NEAR account, or the one destination they signed on that chain).
 */
export function swapRecipient(
  deps: ExecutionDeps,
  intent: IntentRow,
  account: string,
  own: readonly Destination[],
): Destination | null {
  const chain = assetOf(deps, intent.buy_asset).chain;
  if (intent.recipient !== null) return { chain, address: intent.recipient };
  if (chain === 'near') return { chain, address: account };
  const onChain = own.filter((entry) => entry.chain === chain);
  return onChain.length === 1 && onChain[0] ? onChain[0] : null;
}

export function swapIntentView(deps: ExecutionDeps, row: IntentRow) {
  const buy = assetOf(deps, row.buy_asset);
  return {
    id: row.id,
    network: row.network,
    kind: 'swap' as const,
    sell: rawAmount(assetOf(deps, row.sell_asset), row.sell_amount_raw),
    buy: { symbol: buy.symbol, canonicalId: buy.canonicalId, chain: buy.chain },
    recipient: row.recipient,
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
    funding: fundingRequest(deps, row, intent, quote),
    signing: signingRequest(row, intent, quote),
  };
}

/**
 * The one transaction the owner's wallet signs for an approved plan, built here from Harbor's own
 * records so what the wallet shows is exactly what the deposit check later accepts.
 */
function fundingRequest(deps: ExecutionDeps, row: PlanRow, intent: IntentRow, quote: QuoteRow) {
  if (row.status !== 'awaiting_signature' || row.tx_hash !== null || !row.deposit_address) return null;
  const chain = assetOf(deps, intent.sell_asset).chain;
  return {
    chain,
    asset: intent.sell_asset,
    amountRaw: quote.amount_in_raw,
    address: row.deposit_address,
    memo: row.deposit_memo || null,
    walletTransactionAvailable: chain === 'near',
  };
}

function signingRequest(row: PlanRow, intent: IntentRow, quote: QuoteRow) {
  const tokenContract = tokenContractOf(intent.sell_asset);
  if (row.status !== 'awaiting_signature' || row.tx_hash !== null || !row.deposit_address || !tokenContract) {
    return null;
  }
  return depositTransaction({
    signer: row.account_id,
    tokenContract,
    depositAddress: row.deposit_address,
    amountRaw: quote.amount_in_raw,
  });
}

function resolve(deps: ExecutionDeps, symbol: string): AssetRef {
  const asset = deps.assets.bySymbol(symbol);
  if (!asset) throw new AppError('INVALID_REQUEST', `${symbol.slice(0, 16)} is not a supported asset on this network.`);
  return asset;
}

/** Stored intents name registry assets; one missing from the registry is a configuration fault. */
export function assetOf(deps: ExecutionDeps, canonicalId: string): AssetRef {
  const asset = deps.assets.byId(canonicalId);
  if (!asset) throw new AppError('UNAVAILABLE', 'This request names an asset the server no longer supports.');
  return asset;
}
