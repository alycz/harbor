import { z } from 'zod';

const ROUTER = 'https://smartrouter.ref.finance/findPath';
const TIMEOUT_MS = 5_000;
const MAX_BYTES = 262_144;
const CONTRACT = /^[a-z\d][a-z\d._-]{1,63}$/;

const RouterSchema = z.object({
  result_code: z.number(),
  result_data: z
    .object({
      amount_out: z.string().regex(/^(0|[1-9]\d{0,40})$/),
      routes: z.array(z.object({ pools: z.array(z.unknown()).max(8) })).max(16),
    })
    .nullable()
    .optional(),
});

/** A Rhea (Ref Finance) route price for comparison only: Harbor never executes on Rhea. */
export interface RheaReference {
  venue: 'rhea';
  amountOut: bigint;
  hops: number;
}

export interface RheaRouter {
  /** The router's best route for an exact input, or null when it has none or cannot be reached. */
  quote(request: { tokenIn: string; tokenOut: string; amountIn: bigint }): Promise<RheaReference | null>;
  /** The same, with why there is no route when there is none, so a record can say what happened. */
  explain(
    request: { tokenIn: string; tokenOut: string; amountIn: bigint },
    options?: { timeoutMs?: number },
  ): Promise<{ quote: RheaReference } | { reason: string }>;
}

export function createRheaRouter(fetcher: typeof fetch = fetch): RheaRouter {
  async function explain(
    { tokenIn, tokenOut, amountIn }: { tokenIn: string; tokenOut: string; amountIn: bigint },
    { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {},
  ): Promise<{ quote: RheaReference } | { reason: string }> {
    if (!CONTRACT.test(tokenIn) || !CONTRACT.test(tokenOut) || amountIn <= 0n) {
      return { reason: 'Rhea cannot price this pair or amount.' };
    }
    const url = new URL(ROUTER);
    url.search = new URLSearchParams({
      amountIn: amountIn.toString(),
      tokenIn,
      tokenOut,
      pathDeep: '3',
      slippage: '0.005',
    }).toString();
    let response: Response;
    try {
      response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      return { reason: timedOut ? `Rhea did not answer within ${timeoutMs / 1000}s.` : 'Rhea could not be reached.' };
    }
    if (!response.ok) return { reason: `Rhea answered HTTP ${response.status}.` };
    try {
      const text = await response.text();
      if (text.length > MAX_BYTES) return { reason: 'Rhea sent an oversized answer.' };
      const parsed = RouterSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return { reason: 'Rhea sent an answer Harbor could not read.' };
      const data = parsed.data.result_code === 0 ? parsed.data.result_data : null;
      if (!data || data.amount_out === '0' || data.routes.length === 0) {
        return { reason: 'Rhea has no route for this pair and size right now.' };
      }
      return {
        quote: {
          venue: 'rhea',
          amountOut: BigInt(data.amount_out),
          hops: Math.max(...data.routes.map((route) => route.pools.length)),
        },
      };
    } catch {
      return { reason: 'Rhea sent an answer Harbor could not read.' };
    }
  }
  return {
    explain,
    async quote(request) {
      const answer = await explain(request);
      return 'quote' in answer ? answer.quote : null;
    },
  };
}
