import { describe, expect, it } from 'vitest';

import {
  checkSupplyReceipt,
  createRheaReader,
  RHEA_LENDING_CONTRACT,
  RheaReadFailed,
  registrationCall,
  supplyCall,
} from '../src/rhea/lending.ts';
import supplyTx from './fixtures/rhea-supply-tx.json' with { type: 'json' };
import usdcAsset from './fixtures/rhea-usdc-asset.json' with { type: 'json' };

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const RPC = 'https://rpc.test';

/** A real supply on mainnet: 11.171634 USDC, empty msg, 100 Tgas. */
const REAL = {
  txHash: 'CX3nCVEtyTH7k3fhn3NruvYJmb6XXVDMyw4YMHU1dKNh',
  accountId: '12fcdd4683f9cbf36a008f619cf36b56eed5058887125b0355b4fc2d4e714cd1',
  tokenId: USDC,
  amountRaw: 11_171_634n,
  extraDecimals: 12,
};

/** Answers view calls the way NEAR RPC does: the JSON result as a byte array. */
function rpc(views: Record<string, unknown>) {
  const calls: { method: string; args: unknown }[] = [];
  const fetcher = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      method: string;
      params: { method_name?: string; args_base64?: string };
    };
    if (body.method !== 'query') return Response.json({ result: views[body.method] ?? null });
    const name = body.params.method_name ?? '';
    calls.push({ method: name, args: JSON.parse(atob(body.params.args_base64 ?? '')) });
    if (!(name in views)) return Response.json({ result: { error: 'wasm execution failed' } });
    const bytes = [...new TextEncoder().encode(JSON.stringify(views[name]))];
    return Response.json({ result: { result: bytes } });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe('Rhea reader', () => {
  it('reads a market with the token_id argument the contract expects', async () => {
    const fake = rpc({ get_asset: usdcAsset });
    const market = await createRheaReader(RPC, fake.fetcher).market(USDC);
    expect(fake.calls[0]).toEqual({ method: 'get_asset', args: { token_id: USDC } });
    expect(market).toMatchObject({ tokenId: USDC, canDeposit: true, canWithdraw: true, extraDecimals: 12 });
    expect(market.supplyAprPct).toBeGreaterThan(0);
    expect(market.supplyAprPct).toBeLessThan(100);
    // The fixture's cap is 60M USDC with about 12M supplied.
    expect(market.remainingCapRaw).toBeGreaterThan(40_000_000n * 10n ** 6n);
  });

  it('treats a market at or over its cap as full', async () => {
    const full = structuredClone(usdcAsset);
    full.config.supplied_limit = full.supplied.balance;
    const market = await createRheaReader(RPC, rpc({ get_asset: full }).fetcher).market(USDC);
    expect(market.remainingCapRaw).toBe(0n);
  });

  it('refuses a token Rhea does not list instead of guessing', async () => {
    await expect(createRheaReader(RPC, rpc({}).fetcher).market('nope.near')).rejects.toBeInstanceOf(RheaReadFailed);
  });

  it('reads registration, the registration deposit, balances and the supplied position', async () => {
    const reader = createRheaReader(
      RPC,
      rpc({
        storage_balance_of: { total: '100000000000000000000000', available: '0' },
        storage_balance_bounds: { min: '100000000000000000000000', max: null },
        ft_balance_of: '25000000',
        get_account: {
          supplied: [{ token_id: USDC, balance: '30300102886386726882', shares: '1', apr: '0.12' }],
        },
      }).fetcher,
    );
    expect(await reader.registered('alice.near')).toBe(true);
    expect(await reader.registrationDeposit()).toBe(10n ** 23n);
    expect(await reader.tokenBalance(USDC, 'alice.near')).toBe(25_000_000n);
    expect(await reader.supplied('alice.near', USDC, 12)).toBe(30_300_102n);
  });

  it('knows an account Rhea has never seen is not registered and has supplied nothing', async () => {
    const reader = createRheaReader(RPC, rpc({ storage_balance_of: null, get_account: null }).fetcher);
    expect(await reader.registered('new.near')).toBe(false);
    expect(await reader.supplied('new.near', USDC, 12)).toBe(0n);
  });
});

describe('Rhea calls', () => {
  it('supplies with an empty msg, so nothing is posted as collateral', () => {
    expect(supplyCall(USDC, 5_000_000n)).toEqual({
      receiverId: USDC,
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'ft_transfer_call',
            args: { receiver_id: RHEA_LENDING_CONTRACT, amount: '5000000', msg: '' },
            gas: '100000000000000',
            deposit: '1',
          },
        },
      ],
    });
    expect(() => supplyCall(USDC, 0n)).toThrow(RangeError);
  });

  it('registers with Rhea for registration only, so extra NEAR is refunded', () => {
    const call = registrationCall('alice.near', 10n ** 23n);
    expect(call.receiverId).toBe(RHEA_LENDING_CONTRACT);
    expect(call.actions[0].params).toMatchObject({
      methodName: 'storage_deposit',
      args: { account_id: 'alice.near', registration_only: true },
      deposit: '100000000000000000000000',
    });
  });
});

describe('checkSupplyReceipt', () => {
  it('confirms a real mainnet supply', () => {
    expect(checkSupplyReceipt(supplyTx, REAL)).toBe('confirmed');
  });

  it('refuses the transaction for any other plan', () => {
    expect(checkSupplyReceipt(supplyTx, { ...REAL, amountRaw: 11_171_635n })).toBe('mismatch');
    expect(checkSupplyReceipt(supplyTx, { ...REAL, accountId: 'alice.near' })).toBe('mismatch');
    expect(checkSupplyReceipt(supplyTx, { ...REAL, tokenId: 'usdt.tether-token.near' })).toBe('mismatch');
    expect(checkSupplyReceipt(supplyTx, { ...REAL, txHash: 'other' })).toBe('mismatch');
  });

  it('refuses a transfer that posts the tokens as collateral', () => {
    const collateral = structuredClone(supplyTx);
    const action = collateral.transaction.actions[0] as { FunctionCall: { args: string } };
    action.FunctionCall.args = btoa(
      JSON.stringify({
        receiver_id: RHEA_LENDING_CONTRACT,
        amount: '11171634',
        msg: JSON.stringify({ Execute: { actions: [{ IncreaseCollateral: { token_id: USDC } }] } }),
      }),
    );
    expect(checkSupplyReceipt(collateral, REAL)).toBe('mismatch');
  });

  it('reports tokens Rhea handed back as refunded', () => {
    const refunded = structuredClone(supplyTx);
    refunded.status = { SuccessValue: btoa('"0"') };
    expect(checkSupplyReceipt(refunded, REAL)).toBe('refunded');
  });

  it('reports a failed receipt as failed', () => {
    const failed = structuredClone(supplyTx);
    (failed.receipts_outcome[1] as { outcome: { status: unknown } }).outcome.status = { Failure: {} };
    expect(checkSupplyReceipt(failed, REAL)).toBe('failed');
  });

  it('waits while the transaction is not final', () => {
    expect(checkSupplyReceipt({ ...supplyTx, final_execution_status: 'EXECUTED_OPTIMISTIC' }, REAL)).toBe('pending');
    expect(checkSupplyReceipt(null, REAL)).toBe('pending');
  });

  it('needs Rhea to have logged the deposit for this account', () => {
    const silent = structuredClone(supplyTx);
    for (const receipt of silent.receipts_outcome) receipt.outcome.logs = [];
    expect(checkSupplyReceipt(silent, REAL)).toBe('mismatch');
  });
});
