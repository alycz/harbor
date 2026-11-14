import { describe, expect, it } from 'vitest';
import { checkBorrowReceipt } from '../src/templar/borrow.ts';

const ACCOUNT = 'alice.near';
const MARKET = 'usdc-near.v1.tmplr.near';
const HASH = '9Wq3xGhQdA4kPjv3bJcYb6S2tFxw8zQm1nC5rT7uLk2E';
const AMOUNT = '1000000';

function receipt(overrides: { amount?: string; method?: string; status?: object; receipts?: object[] } = {}) {
  const args = btoa(JSON.stringify({ amount: overrides.amount ?? AMOUNT }));
  return {
    final_execution_status: 'FINAL',
    transaction: {
      hash: HASH,
      signer_id: ACCOUNT,
      receiver_id: MARKET,
      actions: [
        {
          FunctionCall: {
            method_name: overrides.method ?? 'borrow',
            args,
            deposit: '0',
            gas: 100_000_000_000_000,
          },
        },
      ],
    },
    status: overrides.status ?? { SuccessValue: '' },
    receipts_outcome: overrides.receipts ?? [{ outcome: { status: { SuccessValue: '' } } }],
  };
}

describe('checkBorrowReceipt', () => {
  it('confirms the exact approved borrow once every receipt succeeded', () => {
    expect(checkBorrowReceipt(receipt(), ACCOUNT, MARKET, AMOUNT, HASH)).toBe('confirmed');
  });

  it('rejects a transaction that borrows a different amount or calls another method', () => {
    expect(checkBorrowReceipt(receipt({ amount: '2000000' }), ACCOUNT, MARKET, AMOUNT, HASH)).toBe('mismatch');
    expect(checkBorrowReceipt(receipt({ method: 'withdraw_collateral' }), ACCOUNT, MARKET, AMOUNT, HASH)).toBe(
      'mismatch',
    );
    expect(checkBorrowReceipt(receipt(), 'mallory.near', MARKET, AMOUNT, HASH)).toBe('mismatch');
  });

  it('reports a failed receipt as failed, never confirmed', () => {
    const failed = receipt({ receipts: [{ outcome: { status: { Failure: { ActionError: {} } } } }] });
    expect(checkBorrowReceipt(failed, ACCOUNT, MARKET, AMOUNT, HASH)).toBe('failed');
  });

  it('waits on anything that is not final or not parseable', () => {
    expect(
      checkBorrowReceipt({ ...receipt(), final_execution_status: 'EXECUTED' }, ACCOUNT, MARKET, AMOUNT, HASH),
    ).toBe('pending');
    expect(checkBorrowReceipt(null, ACCOUNT, MARKET, AMOUNT, HASH)).toBe('pending');
  });
});
