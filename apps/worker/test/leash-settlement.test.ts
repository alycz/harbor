import { describe, expect, it, vi } from 'vitest';
import type { LeashRequest } from '../src/leash/execution.ts';
import { reconcileLeashDelivery } from '../src/leash/settlement.ts';
import { createLeashServiceSigner } from '../src/leash/signer-service.ts';

vi.mock('@harbor/adapters/oneclick/signature', () => ({
  oneClickQuotePayload: (v: unknown) => JSON.stringify(v),
  oneClickQuoteHash: async () => 'quote-hash',
}));
const hash = 'A'.repeat(44);
const quote = {
  destinationAsset: 'nep141:usdc.near',
  recipient: 'owner.near',
  depositAddress: 'a'.repeat(64),
  minAmountOut: '50',
};
const request: LeashRequest = {
  network: 'mainnet',
  signerId: 'agent.near',
  receiverId: 'leash.near',
  methodName: 'execute',
  args: { owner: 'owner.near', quote: JSON.stringify(quote), signature: 'signed' },
  gas: '100000000000000',
  deposit: '0',
};
const payment = {
  final_execution_status: 'FINAL',
  transaction: {
    hash,
    signer_id: 'agent.near',
    receiver_id: 'leash.near',
    actions: [
      {
        FunctionCall: {
          method_name: 'execute',
          args: btoa(JSON.stringify(request.args)),
          gas: request.gas,
          deposit: '0',
        },
      },
    ],
  },
  status: { SuccessValue: '' },
  receipts_outcome: [{ outcome: { status: { SuccessValue: '' } } }],
};
function dependencies(status = 'SUCCESS', balance = 150n) {
  return {
    chain: { transaction: async () => payment, ftBalance: async () => balance },
    evm: { receipt: async () => null },
    assets: { byId: () => ({ canonicalId: 'nep141:usdc.near', chain: 'near' }) },
    executor: { status: async () => ({ status, deliveryTxHashes: [hash] }) },
  } as unknown as Parameters<typeof reconcileLeashDelivery>[1];
}
const input = { request, txHash: hash, quoteResponse: quote, recipientBalanceBeforeRaw: 100n };
describe('Leash delivery verification', () => {
  it('does not trust provider SUCCESS without independently observed delivery', async () => {
    expect((await reconcileLeashDelivery(input, dependencies('SUCCESS', 120n))).settled).toBe(false);
    expect((await reconcileLeashDelivery({ ...input, recipientBalanceBeforeRaw: null }, dependencies())).settled).toBe(
      false,
    );
  });
  it('verifies supported destination balance against recorded baseline and exact signed minimum', async () => {
    expect(await reconcileLeashDelivery(input, dependencies())).toMatchObject({
      state: 'delivery-verified',
      settled: true,
      receivedRaw: '50',
    });
  });
  it('never reports refund as success and rejects substituted quote', async () => {
    expect(await reconcileLeashDelivery(input, dependencies('REFUNDED'))).toMatchObject({
      state: 'refund-reported-unverified',
      settled: false,
    });
    expect(await reconcileLeashDelivery({ ...input, quoteResponse: {} }, dependencies())).toMatchObject({
      state: 'quote-mismatch',
      settled: false,
    });
  });
  it('preserves unknown on RPC outages', async () => {
    const deps = dependencies();
    deps.chain.transaction = async () => {
      throw new Error('timeout');
    };
    expect(await reconcileLeashDelivery(input, deps)).toMatchObject({ state: 'outcome-unknown', settled: false });
  });
});
describe('explicit bounded signer service protocol', () => {
  it('rejects wrong contract without contacting signer', async () => {
    const fetch = vi.fn();
    const signer = createLeashServiceSigner({ fetch } as unknown as Pick<Fetcher, 'fetch'>, 'agent.near', 'leash.near');
    await expect(signer.submit({ ...request, receiverId: 'wrong.near' }, 'claim')).rejects.toThrow('scope');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends only bounded request and requires matching response identity', async () => {
    const fetch = vi.fn(async () => Response.json({ txHash: hash, signerId: 'agent.near', contractId: 'leash.near' }));
    const signer = createLeashServiceSigner({ fetch } as unknown as Pick<Fetcher, 'fetch'>, 'agent.near', 'leash.near');
    expect(await signer.submit(request, 'claim')).toEqual({ txHash: hash });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
