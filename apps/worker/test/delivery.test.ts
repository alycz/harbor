import type { NearChain } from '@harbor/near/chain';
import { describe, expect, it } from 'vitest';
import { type Delivery, type EvmReader, verifyDelivery } from '../src/execution/delivery.ts';

const RECIPIENT = 'closedome193.near';
const MIN = 3_367_589_519_419_680_922_214_672n;
const evm: EvmReader = { receipt: async () => null };

function withdraw(receiver: string, amount: string) {
  const event = {
    standard: 'dip4',
    version: '0.4.3',
    event: 'native_withdraw',
    data: [{ intent_hash: 'hash', account_id: 'abc', receiver_id: receiver, amount }],
  };
  return `EVENT_JSON:${JSON.stringify(event)}`;
}

/** The delivery transaction as the RPC reports it: intents.near paying native NEAR out. */
function deliveryTx(logs: string[], options: { executor?: string; receipt?: Record<string, unknown> } = {}) {
  return {
    status: { SuccessValue: '' },
    receipts_outcome: [
      {
        outcome: {
          executor_id: options.executor ?? 'intents.near',
          logs,
          status: options.receipt ?? { SuccessReceiptId: 'receipt' },
        },
      },
    ],
  };
}

function chainWith(transactions: Record<string, unknown>, wnearBalance = 0n): NearChain {
  return {
    transaction: async (hash) => transactions[hash] ?? null,
    ftBalance: async () => wnearBalance,
    storageRegistered: async () => true,
    storageMinimum: async () => 1n,
  };
}

const delivery: Delivery = {
  chain: 'near',
  recipient: RECIPIENT,
  buyAsset: 'nep141:wrap.near',
  minOutRaw: MIN,
  balanceBeforeRaw: 0n,
  deliveryTxHashes: ['5YAgaU9C7NECqB2E4tpgaypU24V7PPoaVpFCVcURg1u'],
};

describe('delivery of a swap into NEAR', () => {
  it('verifies native NEAR that the intents contract paid out, though the wNEAR balance never moved', async () => {
    const chain = chainWith({
      [delivery.deliveryTxHashes[0] as string]: deliveryTx([withdraw(RECIPIENT, '3379908118320944467557300')]),
    });
    expect(await verifyDelivery(chain, evm, delivery)).toEqual({
      verified: true,
      txHash: '5YAgaU9C7NECqB2E4tpgaypU24V7PPoaVpFCVcURg1u',
      receivedRaw: 3_379_908_118_320_944_467_557_300n,
    });
  });

  it('does not verify a payout below the minimum, to someone else, or logged by another contract', async () => {
    const hash = delivery.deliveryTxHashes[0] as string;
    const cases = [
      deliveryTx([withdraw(RECIPIENT, '1000')]),
      deliveryTx([withdraw('someone.near', '3379908118320944467557300')]),
      deliveryTx([withdraw(RECIPIENT, '3379908118320944467557300')], { executor: 'evil.near' }),
      deliveryTx([withdraw(RECIPIENT, '3379908118320944467557300')], { receipt: { Failure: {} } }),
      { ...deliveryTx([withdraw(RECIPIENT, '3379908118320944467557300')]), status: { Failure: {} } },
    ];
    for (const transaction of cases) {
      expect((await verifyDelivery(chainWith({ [hash]: transaction }), evm, delivery)).verified).toBe(false);
    }
  });

  it('stays unverified while the delivery transaction is unknown', async () => {
    expect((await verifyDelivery(chainWith({}), evm, delivery)).verified).toBe(false);
  });

  it('still verifies a wNEAR payout by the token balance', async () => {
    const paid = chainWith({}, MIN + 1n);
    expect((await verifyDelivery(paid, evm, delivery)).verified).toBe(true);
  });
});
