import type { VenueQuote } from '@harbor/adapters/venue';
import { formatRawAmount, MAX_U128_RAW, parseDecimalAmount } from '@harbor/domain/amount';
import type { AssetRef } from '@harbor/domain/asset';
import { AppError } from '@harbor/domain/errors';
import { z } from 'zod';

import type { ExecutionDeps } from '../execution/store.ts';

export const RoundtripSchema = z.strictObject({
  sellAssetId: z.string().min(3).max(320),
  buyAssetId: z.string().min(3).max(320),
  amount: z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,24})?$/),
  minSpreadBps: z.number().int().min(0).max(10_000).default(0),
});

/** A short local freshness window, not a provider guarantee or an executable quote expiry. */
const FRESHNESS_MS = 30_000;

export async function previewRoundtrip(deps: ExecutionDeps, input: z.infer<typeof RoundtripSchema>) {
  const sell = deps.assets.byId(input.sellAssetId);
  const buy = deps.assets.byId(input.buyAssetId);
  if (!sell || !buy || sell.canonicalId === buy.canonicalId) {
    throw new AppError('INVALID_REQUEST', 'Choose two different assets from the supported registry.');
  }
  let amount: bigint;
  try {
    amount = parseDecimalAmount(input.amount, sell.decimals, MAX_U128_RAW);
  } catch {
    throw new AppError('INVALID_REQUEST', 'The amount exceeds the asset precision or supported range.');
  }
  if (amount <= 0n) throw new AppError('INVALID_REQUEST', 'Enter an amount above zero.');
  const started = deps.now();
  const base = {
    originAssetId: sell.canonicalId,
    viaAssetId: buy.canonicalId,
    amountIn: formatRawAmount(amount, sell.decimals),
    observedAt: new Date(started).toISOString(),
    expiresAt: new Date(started + FRESHNESS_MS).toISOString(),
    expirySource: 'local_freshness_window' as const,
    netProfit: null,
    feesIncluded: false,
    feeNote:
      'Provider quotes include their own route pricing; external funding gas and all execution costs are not independently accounted for.',
    executionAvailable: false,
    atomic: false,
  };
  const legs: Array<{
    amountIn: string;
    amountOut: string;
    minAmountOut: string;
    venue: string;
    observedAt: string;
    expiresAt: string;
  }> = [];
  try {
    const venue = deps.venue;
    if (!venue) throw new Error('Live Intents quotes are available on mainnet only.');
    const read = async (from: AssetRef, to: AssetRef, amountIn: bigint) => {
      const quote = await venue.quote({ network: deps.config.network, sell: from, buy: to, amountIn, slippageBps: 50 });
      validateQuote(quote, amountIn);
      const observed = deps.now();
      legs.push({
        amountIn: formatRawAmount(amountIn, from.decimals),
        amountOut: formatRawAmount(quote.amountOut, to.decimals),
        minAmountOut: formatRawAmount(quote.minAmountOut, to.decimals),
        venue: venue.id,
        observedAt: new Date(observed).toISOString(),
        expiresAt: new Date(started + FRESHNESS_MS).toISOString(),
      });
      return quote;
    };
    const outbound = await read(sell, buy, amount);
    // The second leg quotes only the minimum output, never an optimistic balance.
    const inbound = await read(buy, sell, outbound.minAmountOut);
    if (deps.now() >= started + FRESHNESS_MS) throw new Error('The quote pair is stale; refresh before reviewing.');
    const delta = inbound.minAmountOut - amount;
    const meets = delta > 0n && delta * 10_000n >= amount * BigInt(input.minSpreadBps);
    // Decimal strings preserve large raw amounts without Number rounding.
    const bpsHundredths = (delta * 1_000_000n) / amount;
    const abs = bpsHundredths < 0n ? -bpsHundredths : bpsHundredths;
    const grossSpreadBps = `${bpsHundredths < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
    return {
      ...base,
      status: meets ? ('opportunity' as const) : ('below_threshold' as const),
      amountReturned: formatRawAmount(inbound.minAmountOut, sell.decimals),
      grossSpreadBps,
      legs,
      reason: meets
        ? 'Indicative round-trip spread meets the threshold before external costs. Legs are sequential, not atomic; the return quote may change before funds arrive. Not executable or guaranteed profit.'
        : 'The conservative quoted round trip does not exceed the configured spread threshold. This is monitoring only; nothing was submitted.',
    };
  } catch {
    return {
      ...base,
      status: 'unknown' as const,
      amountReturned: null,
      grossSpreadBps: null,
      legs,
      reason:
        'A live route could not be quoted, returned invalid data, or became stale. No opportunity is inferred and nothing was submitted.',
    };
  }
}

function validateQuote(quote: VenueQuote, expectedInput: bigint) {
  if (
    quote.amountIn !== expectedInput ||
    quote.minAmountOut <= 0n ||
    quote.minAmountOut > quote.amountOut ||
    quote.amountOut > MAX_U128_RAW
  ) {
    throw new Error('Invalid route quote.');
  }
}

export type RoundtripPreview = Awaited<ReturnType<typeof previewRoundtrip>>;
