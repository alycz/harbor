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
}

export function createRheaRouter(fetcher: typeof fetch = fetch): RheaRouter {
  return {
    async quote({ tokenIn, tokenOut, amountIn }) {
      if (!CONTRACT.test(tokenIn) || !CONTRACT.test(tokenOut) || amountIn <= 0n) return null;
      const url = new URL(ROUTER);
      url.search = new URLSearchParams({
        amountIn: amountIn.toString(),
        tokenIn,
        tokenOut,
        pathDeep: '3',
        slippage: '0.005',
      }).toString();
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
        if (!response.ok) return null;
        const text = await response.text();
        if (text.length > MAX_BYTES) return null;
        const parsed = RouterSchema.safeParse(JSON.parse(text));
        const data = parsed.success && parsed.data.result_code === 0 ? parsed.data.result_data : null;
        if (!data || data.amount_out === '0' || data.routes.length === 0) return null;
        return {
          venue: 'rhea',
          amountOut: BigInt(data.amount_out),
          hops: Math.max(...data.routes.map((route) => route.pools.length)),
        };
      } catch {
        return null;
      }
    },
  };
}
