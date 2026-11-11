import { describe, expect, it } from 'vitest';

import {
  checkDeposit,
  createNearChain,
  depositTransaction,
  type PlannedDeposit,
  tokenContractOf,
} from '../src/chain.ts';

const DEPOSIT = '4f8a1c2e9b0d7a6f5e3c1b2a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e';
const planned: PlannedDeposit = {
  signer: 'alice.near',
  tokenContract: 'wrap.near',
  depositAddress: DEPOSIT,
  amountRaw: '1000000000000000000000000',
};

/** The shape NEAR's `tx` RPC returns, built from what the wallet signed. */
function chainResult(
  transaction: ReturnType<typeof depositTransaction>,
  options: { signer?: string; status?: unknown; receipts?: unknown[] } = {},
) {
  return {
    final_execution_status: 'EXECUTED_OPTIMISTIC',
    status: options.status ?? { SuccessValue: '' },
    transaction: {
      signer_id: options.signer ?? planned.signer,
      receiver_id: transaction.receiverId,
      hash: '5r3Yc2Qp1L9xV8nB7mK6jH5gF4dS3aZ2wX1cV9bN8mL7',
      actions: transaction.actions.map((action) => ({
        FunctionCall: {
          method_name: action.params.methodName,
          args: btoa(JSON.stringify(action.params.args)),
          gas: Number(action.params.gas),
          deposit: action.params.deposit,
        },
      })),
    },
    receipts_outcome: options.receipts ?? [{ outcome: { status: { SuccessValue: '' } } }],
  };
}

describe('deposit transactions', () => {
  it('builds register, wrap and transfer for NEAR, and accepts exactly that transaction back', () => {
    const transaction = depositTransaction(planned);
    expect(transaction.receiverId).toBe('wrap.near');
    expect(transaction.actions.map((action) => action.params.methodName)).toEqual([
      'storage_deposit',
      'near_deposit',
      'ft_transfer',
    ]);
    expect(checkDeposit(chainResult(transaction), planned)).toEqual({ outcome: 'confirmed' });
  });

  it('does not wrap when selling a token other than NEAR', () => {
    const usdc = { ...planned, tokenContract: 'usdc.near', amountRaw: '5000000' };
    const transaction = depositTransaction(usdc);
    expect(transaction.actions.map((action) => action.params.methodName)).toEqual(['storage_deposit', 'ft_transfer']);
    expect(checkDeposit(chainResult(transaction), usdc)).toEqual({ outcome: 'confirmed' });
    expect(checkDeposit(chainResult(transaction), planned).outcome).toBe('mismatch');
  });

  it('refuses another signer, another amount, another receiver, or an extra action', () => {
    const transaction = depositTransaction(planned);
    expect(checkDeposit(chainResult(transaction, { signer: 'mallory.near' }), planned).outcome).toBe('mismatch');
    expect(checkDeposit(chainResult(transaction), { ...planned, amountRaw: '2' }).outcome).toBe('mismatch');
    expect(checkDeposit(chainResult(transaction), { ...planned, depositAddress: 'other.near' }).outcome).toBe(
      'mismatch',
    );
    const extra = chainResult(transaction);
    extra.transaction.actions.push({
      FunctionCall: {
        method_name: 'ft_transfer',
        args: btoa(JSON.stringify({ receiver_id: 'attacker.near', amount: '1' })),
        gas: 1,
        deposit: '1',
      },
    });
    expect(checkDeposit(extra, planned).outcome).toBe('mismatch');
  });

  it('reports a failed transaction or receipt as failed, and an unfinished one as pending', () => {
    const transaction = depositTransaction(planned);
    expect(checkDeposit(chainResult(transaction, { status: { Failure: { ActionError: {} } } }), planned).outcome).toBe(
      'failed',
    );
    const failedReceipt = chainResult(transaction, { receipts: [{ outcome: { status: { Failure: {} } } }] });
    expect(checkDeposit(failedReceipt, planned).outcome).toBe('failed');
    expect(checkDeposit(chainResult(transaction, { status: { Started: null } }), planned).outcome).toBe('pending');
    expect(checkDeposit(null, planned).outcome).toBe('pending');
  });

  it('names the NEP-141 contract behind an asset ID', () => {
    expect(tokenContractOf('nep141:wrap.near')).toBe('wrap.near');
    expect(tokenContractOf('nep245:v2_1.omni.hot.tg:56_11111')).toBeNull();
  });
});

describe('NEAR RPC reads', () => {
  it('treats an unknown transaction as not there yet, and reads a token balance', async () => {
    const answers: Record<string, unknown> = {
      tx: { error: { cause: { name: 'UNKNOWN_TRANSACTION' } } },
      query: { result: { result: Array.from(new TextEncoder().encode('"1234"')) } },
    };
    const chain = createNearChain('https://rpc.test', async (_url, init) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string };
      return Response.json({ jsonrpc: '2.0', id: 'harbor', ...(answers[method] as object) });
    });
    expect(await chain.transaction('5r3Yc2Qp1L9xV8nB7mK6jH5gF4dS3aZ2wX1cV9bN8mL7', 'alice.near')).toBeNull();
    expect(await chain.ftBalance('usdc.near', 'alice.near')).toBe(1234n);
    expect(await chain.transaction('not-a-hash', 'alice.near')).toBeNull();
  });

  it('fails the read, rather than guessing, when the RPC is down', async () => {
    const chain = createNearChain('https://rpc.test', async () => {
      throw new Error('down');
    });
    await expect(chain.ftBalance('usdc.near', 'alice.near')).rejects.toThrow('did not answer');
  });
});
