import type { AssetRef } from '@harbor/domain/asset';
import { ONE_CLICK_ASSETS } from '@harbor/domain/oneclick-assets';
import { describe, expect, it } from 'vitest';

import { OneClickClientError, type OneClickQuoteRequest, type VerifiedOneClickQuote } from '../src/oneclick/client.ts';
import { oneClickVenue } from '../src/oneclick/venue.ts';
import { VenueRefusal } from '../src/venue.ts';

const asset = (symbol: string): AssetRef => {
  const found = ONE_CLICK_ASSETS.find((candidate) => candidate.symbol === symbol);
  if (!found) throw new Error(`No asset ${symbol}`);
  return found;
};
const NOW = Date.parse('2026-11-04T12:00:00Z');

function fakeClient(answer: (request: OneClickQuoteRequest) => VerifiedOneClickQuote) {
  const requests: OneClickQuoteRequest[] = [];
  return {
    requests,
    client: {
      async quote(request: OneClickQuoteRequest) {
        requests.push(request);
        return answer(request);
      },
    },
  };
}

const verified = {
  quoteHash: 'hash-1',
  response: { quote: { amountIn: '1000', amountOut: '2500', minAmountOut: '2475' } },
} as unknown as VerifiedOneClickQuote;

describe('oneClickVenue', () => {
  it('asks for a dry exact-input quote and reports what it returns', async () => {
    const fake = fakeClient(() => verified);
    const venue = oneClickVenue(fake.client, () => NOW);
    const quote = await venue.quote({
      network: 'mainnet',
      sell: asset('NEAR'),
      buy: asset('USDC'),
      amountIn: 1000n,
      slippageBps: 100,
    });
    expect(fake.requests[0]).toMatchObject({
      dry: true,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: 'nep141:wrap.near',
      destinationAsset: asset('USDC').canonicalId,
      amount: '1000',
      deadline: new Date(NOW + 3_600_000).toISOString(),
    });
    expect(quote).toMatchObject({ amountIn: 1000n, amountOut: 2500n, minAmountOut: 2475n, priceImpactBps: null });
    expect(quote.raw).toMatchObject({ quoteHash: 'hash-1' });
  });

  it('uses stand-in addresses that match each chain until an account is given', async () => {
    const fake = fakeClient(() => verified);
    const venue = oneClickVenue(fake.client, () => NOW);
    await venue.quote({
      network: 'mainnet',
      sell: asset('NEAR'),
      buy: asset('USDC.arb'),
      amountIn: 1n,
      slippageBps: 50,
    });
    expect(fake.requests[0]).toMatchObject({
      refundTo: 'intents.near',
      recipient: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
    });
    await venue.quote({
      network: 'mainnet',
      sell: asset('NEAR'),
      buy: asset('USDC'),
      amountIn: 1n,
      slippageBps: 50,
      refundTo: 'alice.near',
      recipient: 'alice.near',
    });
    expect(fake.requests[1]).toMatchObject({ refundTo: 'alice.near', recipient: 'alice.near' });
  });

  it('treats a client error answer as no route, and passes anything else through', async () => {
    const noRoute = oneClickVenue(
      fakeClient(() => {
        throw new OneClickClientError('HTTP_ERROR', 'NEAR Intents request failed with HTTP 400');
      }).client,
    );
    await expect(
      noRoute.quote({ network: 'mainnet', sell: asset('NEAR'), buy: asset('USDC'), amountIn: 1n, slippageBps: 50 }),
    ).rejects.toBeInstanceOf(VenueRefusal);
    const outage = oneClickVenue(
      fakeClient(() => {
        throw new OneClickClientError('HTTP_ERROR', 'NEAR Intents request failed with HTTP 503');
      }).client,
    );
    await expect(
      outage.quote({ network: 'mainnet', sell: asset('NEAR'), buy: asset('USDC'), amountIn: 1n, slippageBps: 50 }),
    ).rejects.toBeInstanceOf(OneClickClientError);
  });

  it('suggests the bridge minimum when the amount is too small', async () => {
    const venue = oneClickVenue(
      fakeClient(() => {
        throw new OneClickClientError('HTTP_ERROR', 'NEAR Intents request failed with HTTP 400', {
          providerMessage: 'Amount is too low for bridge, try at least 1644949988240604987552888',
        });
      }).client,
    );
    await expect(
      venue.quote({
        network: 'mainnet',
        sell: asset('NEAR'),
        buy: asset('ETH'),
        amountIn: 10n ** 24n,
        slippageBps: 100,
      }),
    ).rejects.toThrow('Try at least 1.65 NEAR.');
  });

  it('refuses a chain it has no address format for', async () => {
    const venue = oneClickVenue(fakeClient(() => verified).client);
    await expect(
      venue.quote({
        network: 'mainnet',
        sell: asset('NEAR'),
        buy: { ...asset('USDC'), chain: 'xyz' },
        amountIn: 1n,
        slippageBps: 50,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CHAIN' });
  });
});
