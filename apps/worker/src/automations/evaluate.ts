import type { PriceAlertConfig, SpreadAlertConfig } from './config.ts';

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

/** One priced leg of a round trip. */
interface Leg {
  venue: string;
  sell: { symbol: string; amount: string };
  buy: { symbol: string; amount: string };
}

/** A round trip: buy the base on one venue, sell it on the other, and what came back. */
export interface RoundTrip {
  /** Where the base was bought, then sold. */
  route: 'intents_then_rhea' | 'rhea_then_intents';
  legs: Leg[];
  /** What the round trip returned, in the quote asset, or null when a leg could not be priced. */
  returned: string | null;
  /** Gain over `size`, in percent, rounded to four places; negative is a loss. */
  edgePct: number | null;
  error: string | null;
}

export interface SpreadEvaluation {
  result: EvaluationResult;
  reason: string;
  evidence: {
    size: { symbol: string; amount: string };
    thresholdPct: number;
    trips: RoundTrip[];
    /** The better trip by edge, when either could be priced. */
    best: RoundTrip['route'] | null;
  };
}

const VENUE_NAMES: Record<RoundTrip['route'], [string, string]> = {
  intents_then_rhea: ['NEAR Intents', 'Rhea'],
  rhea_then_intents: ['Rhea', 'NEAR Intents'],
};

/**
 * Prices `size` of the quote asset round-tripping through the base asset, both ways, with real quotes
 * from each venue: each leg's output is the next leg's input, so fees and price impact on both venues
 * are in the result. Network gas is not. An unpriceable trip is `unknown` evidence, never a loss.
 */
export async function evaluateSpreadAlert(
  config: SpreadAlertConfig,
  venues: { intents: QuoteSource; rhea: QuoteSource },
): Promise<SpreadEvaluation> {
  const trip = async (route: RoundTrip['route']): Promise<RoundTrip> => {
    const [first, second] =
      route === 'intents_then_rhea' ? [venues.intents, venues.rhea] : [venues.rhea, venues.intents];
    const [firstName, secondName] = VENUE_NAMES[route];
    const legs: Leg[] = [];
    try {
      const bought = await first.read({
        sellAssetId: config.quote.assetId,
        buyAssetId: config.base.assetId,
        amount: config.size,
      });
      if (!DECIMAL.test(bought.amountOut) || bought.amountOut === '0')
        throw new Error(`${firstName} returned no amount.`);
      legs.push({
        venue: firstName,
        sell: { symbol: config.quote.symbol, amount: config.size },
        buy: { symbol: config.base.symbol, amount: bought.amountOut },
      });
      const sold = await second.read({
        sellAssetId: config.base.assetId,
        buyAssetId: config.quote.assetId,
        amount: bought.amountOut,
      });
      if (!DECIMAL.test(sold.amountOut)) throw new Error(`${secondName} returned a malformed amount.`);
      legs.push({
        venue: secondName,
        sell: { symbol: config.base.symbol, amount: bought.amountOut },
        buy: { symbol: config.quote.symbol, amount: sold.amountOut },
      });
      return { route, legs, returned: sold.amountOut, edgePct: edgePct(config.size, sold.amountOut), error: null };
    } catch (error) {
      return { route, legs, returned: null, edgePct: null, error: messageOf(error) };
    }
  };
  // Sequential: the two trips share both venues, and parallel bursts invite rate limits.
  const trips = [await trip('intents_then_rhea'), await trip('rhea_then_intents')];
  const priced = trips.filter((entry): entry is RoundTrip & { edgePct: number } => entry.edgePct !== null);
  const best = priced.reduce<(RoundTrip & { edgePct: number }) | null>(
    (leader, entry) => (leader === null || entry.edgePct > leader.edgePct ? entry : leader),
    null,
  );
  const evidence: SpreadEvaluation['evidence'] = {
    size: { symbol: config.quote.symbol, amount: config.size },
    thresholdPct: config.thresholdPct,
    trips,
    best: best?.route ?? null,
  };
  if (!best) {
    return {
      result: 'unknown',
      reason: `Neither round trip could be priced: ${trips.map((entry) => entry.error).join(' ')}`,
      evidence,
    };
  }
  const [buyOn, sellOn] = VENUE_NAMES[best.route];
  const met = best.edgePct >= config.thresholdPct;
  const reason =
    `Best round trip: buy ${config.base.symbol} on ${buyOn}, sell on ${sellOn}. ` +
    `${config.size} ${config.quote.symbol} returns ${best.returned} ${config.quote.symbol} ` +
    `(${best.edgePct >= 0 ? '+' : ''}${best.edgePct.toFixed(2)}%), ${met ? 'at or above' : 'below'} the ` +
    `${config.thresholdPct}% threshold. Venue fees included, network gas not.`;
  return { result: met ? 'true' : 'false', reason, evidence };
}

/** (returned − size) / size, in percent to four places, from exact decimals. */
export function edgePct(size: string, returned: string): number {
  const scale = Math.max(fractionLength(size), fractionLength(returned));
  const start = scaled(size, scale);
  const end = scaled(returned, scale);
  if (start === 0n) return 0;
  // Basis points of a basis point: four decimal places of a percent.
  return Number(((end - start) * 1_000_000n) / start) / 10_000;
}

function fractionLength(value: string): number {
  return value.split('.')[1]?.length ?? 0;
}

function scaled(value: string, scale: number): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(scale, '0'));
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
