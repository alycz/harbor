import type { PriceAlertConfig } from './config.ts';

type EvaluationResult = 'true' | 'false' | 'unknown';

interface QuoteReading {
  /** What the venue quoted for the sell amount, as a decimal in the buy asset. */
  amountOut: string;
  venue: string;
  observedAtMs: number;
}

/** Quotes one swap now. Injected so tests and previews run without the network. */
export interface QuoteSource {
  read(request: { sellAssetId: string; buyAssetId: string; amount: string }): Promise<QuoteReading>;
}

export interface Evaluation {
  result: EvaluationResult;
  reason: string;
  evidence: {
    reading: { amountOut: string; venue: string; observedAt: string } | null;
    error: string | null;
    sell: { symbol: string; amount: string };
    buy: { symbol: string };
    minOutput: string;
  };
}

const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Quotes the rule's swap now and asks whether the output reaches the target. An unreadable or
 * malformed quote gives `unknown` with the reason, never `false`.
 */
export async function evaluatePriceAlert(config: PriceAlertConfig, quotes: QuoteSource): Promise<Evaluation> {
  const evidence: Evaluation['evidence'] = {
    reading: null,
    error: null,
    sell: { symbol: config.sell.symbol, amount: config.sell.amount },
    buy: { symbol: config.buy.symbol },
    minOutput: config.minOutput,
  };
  let reading: QuoteReading;
  try {
    reading = await quotes.read({
      sellAssetId: config.sell.assetId,
      buyAssetId: config.buy.assetId,
      amount: config.sell.amount,
    });
  } catch (error) {
    evidence.error = messageOf(error);
    return { result: 'unknown', reason: `The swap could not be quoted. ${evidence.error}`, evidence };
  }
  if (!DECIMAL.test(reading.amountOut)) {
    evidence.error = 'The venue returned a malformed amount.';
    return { result: 'unknown', reason: evidence.error, evidence };
  }
  evidence.reading = {
    amountOut: reading.amountOut,
    venue: reading.venue,
    observedAt: new Date(reading.observedAtMs).toISOString(),
  };
  const met = compareDecimal(reading.amountOut, config.minOutput) >= 0;
  const reason =
    `${config.sell.amount} ${config.sell.symbol} quotes ${reading.amountOut} ${config.buy.symbol} on ${reading.venue}, ` +
    `${met ? 'at or above' : 'below'} the ${config.minOutput} ${config.buy.symbol} target.`;
  return { result: met ? 'true' : 'false', reason, evidence };
}

/** Exact comparison of two plain non-negative decimals. */
export function compareDecimal(a: string, b: string): number {
  const [aWhole = '0', aFraction = ''] = a.split('.');
  const [bWhole = '0', bFraction = ''] = b.split('.');
  const scale = Math.max(aFraction.length, bFraction.length);
  const left = BigInt(aWhole + aFraction.padEnd(scale, '0'));
  const right = BigInt(bWhole + bFraction.padEnd(scale, '0'));
  return left === right ? 0 : left > right ? 1 : -1;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : 'unknown error';
}
