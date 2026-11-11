import type { AssetRef } from '@harbor/domain/asset';
import { ONE_CLICK_ASSETS } from '@harbor/domain/oneclick-assets';
import { describe, expect, it } from 'vitest';

import {
  createOneClickClient,
  OneClickClientError,
  type OneClickQuoteRequest,
  type OneClickStatusResponse,
  type VerifiedOneClickQuote,
} from '../src/oneclick/client.ts';
import { oneClickExecutor } from '../src/oneclick/venue.ts';
import { VenueRefusal } from '../src/venue.ts';

const asset = (symbol: string): AssetRef => {
  const found = ONE_CLICK_ASSETS.find((candidate) => candidate.symbol === symbol);
  if (!found) throw new Error(`No asset ${symbol}`);
  return found;
};
const NOW = Date.parse('2026-11-11T12:00:00Z');
const DEPOSIT = '4f8a1c2e9b0d7a6f5e3c1b2a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e';
const REQUEST = {
  network: 'mainnet' as const,
  sell: asset('NEAR'),
  buy: asset('USDC'),
  amountIn: 1000n,
  slippageBps: 50,
  refundTo: 'alice.near',
  recipient: 'alice.near',
};

const executable = {
  quoteHash: 'hash-exec',
  response: {
    correlationId: 'corr-1',
    quote: {
      amountIn: '1000',
      amountOut: '2500',
      minAmountOut: '2487',
      depositAddress: DEPOSIT,
      deadline: '2026-11-11T12:10:00.000Z',
    },
  },
} as unknown as VerifiedOneClickQuote;

/** A status report as 1Click signs it, with only the fields the executor reads filled in. */
function report(
  status: OneClickStatusResponse['status'],
  details: Partial<OneClickStatusResponse['swapDetails']> = {},
) {
  return {
    status,
    updatedAt: '2026-11-11T12:03:00.000Z',
    swapDetails: {
      intentHashes: [],
      nearTxHashes: [],
      originChainTxHashes: [],
      destinationChainTxHashes: [],
      ...details,
    },
  } as unknown as OneClickStatusResponse;
}

function fake(answers: { status?: OneClickStatusResponse; refuse?: boolean } = {}) {
  const calls: { quote: OneClickQuoteRequest[]; status: unknown[]; submitted: unknown[] } = {
    quote: [],
    status: [],
    submitted: [],
  };
  return {
    calls,
    client: {
      async quote(request: OneClickQuoteRequest) {
        calls.quote.push(request);
        if (answers.refuse) {
          throw new OneClickClientError('HTTP_ERROR', 'NEAR Intents request failed with HTTP 400', {
            providerMessage: 'Amount is too low for bridge, try at least 500000000000000000000000',
          });
        }
        return executable;
      },
      async status(input: unknown) {
        calls.status.push(input);
        return answers.status ?? report('PROCESSING');
      },
      async submitDeposit(input: unknown) {
        calls.submitted.push(input);
      },
    },
  };
}

describe('oneClickExecutor', () => {
  it('asks for an executable quote paid back to the owner and delivered to their own recipient', async () => {
    const f = fake();
    const quote = await oneClickExecutor(f.client, () => NOW).executableQuote(REQUEST);
    expect(f.calls.quote[0]).toMatchObject({
      dry: false,
      depositType: 'ORIGIN_CHAIN',
      refundTo: 'alice.near',
      refundType: 'ORIGIN_CHAIN',
      recipient: 'alice.near',
      recipientType: 'DESTINATION_CHAIN',
      slippageTolerance: 50,
      deadline: '2026-11-11T12:10:00.000Z',
    });
    expect(quote).toMatchObject({ amountIn: 1000n, minAmountOut: 2487n });
    expect(quote.deposit).toEqual({
      address: DEPOSIT,
      memo: null,
      deadlineMs: Date.parse('2026-11-11T12:10:00.000Z'),
      quoteHash: 'hash-exec',
      correlationId: 'corr-1',
    });
  });

  it('turns a 1Click refusal into a refusal the user can act on', async () => {
    await expect(oneClickExecutor(fake({ refuse: true }).client).executableQuote(REQUEST)).rejects.toBeInstanceOf(
      VenueRefusal,
    );
  });

  it('binds status to the deposit and quote hash, and reports refunds and deliveries as numbers', async () => {
    const refunded = fake({
      status: report('REFUNDED', { refundedAmount: '1000', refundReason: 'Price moved' }),
    });
    const settled = await oneClickExecutor(refunded.client).status({
      depositAddress: DEPOSIT,
      memo: null,
      quoteHash: 'hash-exec',
    });
    expect(refunded.calls.status[0]).toEqual({ depositAddress: DEPOSIT, expectedQuoteHash: 'hash-exec' });
    expect(settled).toMatchObject({ status: 'REFUNDED', refundedAmount: 1000n, refundReason: 'Price moved' });

    const delivered = fake({
      status: report('SUCCESS', {
        amountOut: '2490',
        destinationChainTxHashes: [{ hash: '0xabc', explorerUrl: 'https://basescan.org/tx/0xabc' }],
      }),
    });
    expect(
      await oneClickExecutor(delivered.client).status({ depositAddress: DEPOSIT, memo: null, quoteHash: 'h' }),
    ).toMatchObject({ status: 'SUCCESS', amountOut: 2490n, deliveryTxHashes: ['0xabc'] });
  });

  it('names the sender when it tells 1Click about a NEAR deposit', async () => {
    const f = fake();
    await oneClickExecutor(f.client).submitDeposit({
      txHash: '5r3Yc2Qp1L9xV8nB7mK6jH5gF4dS3aZ2wX1cV9bN8mL7',
      depositAddress: DEPOSIT,
      memo: null,
      sender: 'alice.near',
    });
    expect(f.calls.submitted[0]).toEqual({
      txHash: '5r3Yc2Qp1L9xV8nB7mK6jH5gF4dS3aZ2wX1cV9bN8mL7',
      depositAddress: DEPOSIT,
      nearSenderAccount: 'alice.near',
    });
  });

  it('never sends deposit notices while executable quotes are off', async () => {
    const client = createOneClickClient({
      fetch: async () => {
        throw new Error('should not be called');
      },
    });
    await expect(client.submitDeposit({ txHash: 'x', depositAddress: DEPOSIT })).rejects.toMatchObject({
      code: 'EXECUTION_DISABLED',
    });
  });
});
