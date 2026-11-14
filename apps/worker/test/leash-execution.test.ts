import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { type LeashRequest, submitLeash, verifyLeashPayment } from '../src/leash/execution.ts';
import { leashJournal } from '../src/leash/journal.ts';

vi.hoisted(() => vi.resetModules());

vi.mock('@harbor/adapters/oneclick/signature', () => ({
  verifyOneClickQuoteSignature: async (value: { valid?: boolean }) => value.valid === true,
  oneClickQuotePayload: (value: { payload: unknown }) => JSON.stringify(value.payload),
}));
const hash = 'A'.repeat(44);
const input = () => ({
  id: 'execution_123',
  owner: 'owner.near',
  contract: 'leash.near',
  agent: 'agent.near',
  quoteResponse: {
    valid: true,
    payload: { dry: false, refundTo: 'owner.near', deadline: new Date(Date.now() + 60000).toISOString() },
  },
});
function dependencies() {
  return {
    enabled: true,
    contractId: 'leash.near',
    agentAccountId: 'agent.near',
    authorize: vi.fn(async () => true),
    signer: { accountId: 'agent.near', contractId: 'leash.near', submit: vi.fn(async () => ({ txHash: hash })) },
    journal: { claim: vi.fn(async () => true), submitted: vi.fn(async () => {}), unknown: vi.fn(async () => {}) },
  };
}

describe('bounded Leash coordinator', () => {
  it('does not invoke an absent signer or disabled execution', async () => {
    const deps = dependencies();
    deps.enabled = false;
    await expect(submitLeash(input(), deps)).rejects.toThrow('not enabled');
    expect(deps.signer.submit).not.toHaveBeenCalled();
    expect(deps.journal.claim).not.toHaveBeenCalled();
  });
  it('rejects mismatched signer authority before accessing it', async () => {
    const deps = dependencies();
    deps.signer.contractId = 'other.near';
    await expect(submitLeash(input(), deps)).rejects.toThrow('scope mismatch');
    expect(deps.signer.submit).not.toHaveBeenCalled();
  });
  it('requires provider signature and fresh vault authorization', async () => {
    const deps = dependencies();
    const request = input();
    request.quoteResponse.valid = false;
    await expect(submitLeash(request, deps)).rejects.toThrow('signature');
    deps.authorize.mockResolvedValue(false);
    await expect(submitLeash(input(), deps)).rejects.toThrow('authorization denied');
    expect(deps.signer.submit).not.toHaveBeenCalled();
  });
  it('never resubmits an already claimed plan', async () => {
    const deps = dependencies();
    deps.journal.claim.mockResolvedValue(false);
    await expect(submitLeash(input(), deps)).rejects.toThrow('already claimed');
    expect(deps.signer.submit).not.toHaveBeenCalled();
  });
  it('claims durably before submission and does not call it settled', async () => {
    const deps = dependencies();
    const result = await submitLeash(input(), deps);
    expect(result.state).toBe('submitted-not-settled');
    expect(deps.journal.submitted).toHaveBeenCalled();
    expect(deps.journal.claim.mock.invocationCallOrder[0]).toBeLessThan(
      deps.signer.submit.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result.request.deposit).toBe('0');
    expect(result.request.methodName).toBe('execute');
  });
  it('retains ambiguous claims on signer failure rather than retrying', async () => {
    const deps = dependencies();
    deps.signer.submit.mockRejectedValue(new Error('timeout after broadcast'));
    await expect(submitLeash(input(), deps)).rejects.toThrow('Outcome unknown');
    expect(deps.signer.submit).toHaveBeenCalledTimes(1);
    expect(deps.journal.unknown).toHaveBeenCalled();
  });
});

describe('Leash payment evidence', () => {
  const request: LeashRequest = {
    network: 'mainnet',
    signerId: 'agent.near',
    receiverId: 'leash.near',
    methodName: 'execute',
    args: { owner: 'owner.near', quote: '{}', signature: 'signed' },
    gas: '100000000000000',
    deposit: '0',
  };
  const receipt = () => ({
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
  });
  it('confirms payment only, not destination settlement', () =>
    expect(verifyLeashPayment(receipt(), request, hash)).toBe('payment-confirmed-delivery-unverified'));
  it('rejects different hash or arguments and waits for finality', () => {
    expect(verifyLeashPayment(receipt(), request, 'B'.repeat(44))).toBe('mismatch');
    const value = receipt();
    const first = value.transaction.actions[0];
    if (!first) throw new Error('Missing fixture action');
    first.FunctionCall.args = btoa('{}');
    expect(verifyLeashPayment(value, request, hash)).toBe('mismatch');
    expect(verifyLeashPayment({ ...receipt(), final_execution_status: 'EXECUTED' }, request, hash)).toBe('pending');
  });
});

describe('durable Leash claims', () => {
  it('admits only one concurrent request and keeps an uncertain claim locked', async () => {
    const journal = leashJournal(env.DB);
    const id = crypto.randomUUID();
    const digest = crypto.randomUUID();
    const results = await Promise.all([
      journal.claim(id, 'owner.near', digest),
      journal.claim(id, 'owner.near', digest),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await journal.unknown(id, digest);
    expect(await journal.claim(id, 'owner.near', digest)).toBe(false);
    expect(await journal.claim(crypto.randomUUID(), 'owner.near', digest)).toBe(false);
    const row = await env.DB.prepare('SELECT state FROM leash_executions WHERE id=?')
      .bind(id)
      .first<{ state: string }>();
    expect(row?.state).toBe('outcome_unknown');
  });
});
