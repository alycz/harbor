import { describe, expect, it } from 'vitest';

import { createRheaRouter } from '../src/rhea/router.ts';

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

/** Answers the way the router answered on 2026-11-11, as text/plain JSON. */
function router(body: unknown, status = 200) {
  const requests: URL[] = [];
  return {
    requests,
    fetch: (async (input: string | URL | Request) => {
      requests.push(new URL(String(input)));
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }) as typeof fetch,
  };
}

describe('Rhea router', () => {
  it('reads the best route for an exact input', async () => {
    const fake = router({
      result_code: 0,
      result_message: '',
      result_data: {
        routes: [{ pools: [{ pool_id: '4512' }] }],
        contract_in: 'wrap.near',
        contract_out: USDC,
        amount_in: '1000000000000000000000000',
        amount_out: '3645936',
      },
    });
    const quote = await createRheaRouter(fake.fetch).quote({
      tokenIn: 'wrap.near',
      tokenOut: USDC,
      amountIn: 10n ** 24n,
    });
    expect(quote).toEqual({ venue: 'rhea', amountOut: 3_645_936n, hops: 1 });
    expect(fake.requests[0]?.searchParams.get('tokenOut')).toBe(USDC);
  });

  it('gives no reference, rather than a wrong one, for no route, bad data or an outage', async () => {
    const request = { tokenIn: 'wrap.near', tokenOut: USDC, amountIn: 1n };
    expect(
      await createRheaRouter(router({ result_code: 0, result_data: { amount_out: '0', routes: [] } }).fetch).quote(
        request,
      ),
    ).toBeNull();
    expect(
      await createRheaRouter(router({ result_code: 1, result_message: 'No path' }).fetch).quote(request),
    ).toBeNull();
    expect(
      await createRheaRouter(router({ result_code: 0, result_data: { amount_out: '-5', routes: [] } }).fetch).quote(
        request,
      ),
    ).toBeNull();
    expect(await createRheaRouter(router({}, 502).fetch).quote(request)).toBeNull();
    const down = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await createRheaRouter(down).quote(request)).toBeNull();
    expect(await createRheaRouter(router({}).fetch).quote({ ...request, tokenIn: 'Not A Contract' })).toBeNull();
  });
});
