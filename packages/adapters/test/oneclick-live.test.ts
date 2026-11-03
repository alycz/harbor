import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createOneClickClient } from '../src/oneclick/client.ts';

const WNEAR = 'nep141:wrap.near';
const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

// Opt-in: HARBOR_LIVE_ONECLICK=1 pnpm --filter @harbor/adapters test
describe.skipIf(env.HARBOR_LIVE_ONECLICK !== '1')('1Click live', () => {
  const client = createOneClickClient({ timeoutMs: 15_000 });

  it('lists tokens, including wNEAR and USDC on NEAR', async () => {
    const tokens = await client.tokens();
    const ids = new Set(tokens.map((token) => token.assetId));
    expect(ids.has(WNEAR)).toBe(true);
    expect(ids.has(USDC)).toBe(true);
  });

  it('returns a dry quote whose provider signature verifies', async () => {
    const { response, quoteHash } = await client.quote({
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: WNEAR,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: USDC,
      amount: '1000000000000000000000000',
      refundTo: 'alice.near',
      refundType: 'ORIGIN_CHAIN',
      recipient: 'alice.near',
      recipientType: 'DESTINATION_CHAIN',
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
    });
    console.log(JSON.stringify({ quoteHash, amountOut: response.quote.amountOutFormatted }));
    expect(BigInt(response.quote.minAmountOut)).toBeGreaterThan(0n);
    expect(response.quote.depositAddress).toBeUndefined();
  });
});
