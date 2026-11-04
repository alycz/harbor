import { env } from 'cloudflare:workers';
import { ONE_CLICK_ASSETS } from '@harbor/domain/oneclick-assets';
import { describe, expect, it } from 'vitest';

import { createOneClickClient } from '../src/oneclick/client.ts';
import { oneClickVenue } from '../src/oneclick/venue.ts';

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

  it('quotes 5 NEAR into every asset Harbor offers', async () => {
    const venue = oneClickVenue(client);
    const near = ONE_CLICK_ASSETS.find((asset) => asset.symbol === 'NEAR');
    if (!near) throw new Error('NEAR is missing from the asset list');
    for (const buy of ONE_CLICK_ASSETS.filter((asset) => asset !== near)) {
      const quote = await venue.quote({
        network: 'mainnet',
        sell: near,
        buy,
        amountIn: 5n * 10n ** 24n,
        slippageBps: 100,
      });
      console.log(JSON.stringify({ buy: buy.symbol, amountOut: quote.amountOut.toString() }));
      expect(quote.minAmountOut).toBeGreaterThan(0n);
    }
  }, 120_000);
});
