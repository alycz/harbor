import { describe, expect, it } from 'vitest';

import { createRheaLending, RHEA_LENDING_CONTRACT, RheaRegistrationRequired } from '../src/rhea/lending.ts';

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const OWNER = 'alice.near';
const RPC = 'https://rpc.mainnet.near.org';

/** The shape `get_asset` returned for USDC on 2026-11-15, trimmed to what Harbor reads. */
const USDC_ASSET = {
  token_id: USDC,
  supplied: { shares: '1', balance: '12175654532026803451228896' },
  supply_apr: '0.117260931641168647809485079',
  config: { can_deposit: true, can_withdraw: true, extra_decimals: 12 },
};

interface Call {
  accountId: string;
  method: string;
  args: Record<string, unknown>;
  init: RequestInit;
}

/** A NEAR RPC that answers view calls from a table, and records every call it was asked. */
function rpc(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      params: { account_id: string; method_name: string; args_base64: string };
    };
    const call = {
      accountId: body.params.account_id,
      method: body.params.method_name,
      args: JSON.parse(atob(body.params.args_base64)) as Record<string, unknown>,
      init: init ?? {},
    };
    calls.push(call);
    const key = `${call.accountId}:${call.method}`;
    if (!(key in answers)) return new Response(JSON.stringify({ error: { message: `no answer for ${key}` } }));
    const bytes = [...new TextEncoder().encode(JSON.stringify(answers[key]))];
    return new Response(JSON.stringify({ result: { result: bytes } }));
  }) as typeof fetch;
  return { calls, fetcher };
}

const registered = { total: '100000000000000000000000', available: '0' };

describe('Rhea lending', () => {
  it('reads a market with the contract argument name it requires, without following redirects', async () => {
    const fake = rpc({ [`${RHEA_LENDING_CONTRACT}:get_asset`]: USDC_ASSET });
    const market = await createRheaLending(RPC, fake.fetcher).market(USDC);
    expect(fake.calls[0]?.args).toEqual({ token_id: USDC });
    // Workers reject redirect: 'error', so every chain read must use 'manual'.
    expect(fake.calls[0]?.init.redirect).toBe('manual');
    expect(market).toEqual({
      tokenId: USDC,
      supplyAprPct: expect.closeTo(11.726, 3),
      suppliedRaw: '12175654532026803451228896',
      extraDecimals: 12,
      canDeposit: true,
      canWithdraw: true,
    });
  });

  it('prepares a supply-only transfer once balance and registration check out', async () => {
    const fake = rpc({
      [`${RHEA_LENDING_CONTRACT}:get_asset`]: USDC_ASSET,
      [`${USDC}:ft_balance_of`]: '50000000',
      [`${RHEA_LENDING_CONTRACT}:storage_balance_of`]: registered,
    });
    const plan = await createRheaLending(RPC, fake.fetcher).prepareSupply({
      network: 'near:mainnet',
      accountId: OWNER,
      tokenId: USDC,
      amount: 25_000_000n,
    });
    expect(plan.transaction).toEqual({
      receiverId: USDC,
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'ft_transfer_call',
            args: { receiver_id: RHEA_LENDING_CONTRACT, amount: '25000000', msg: '' },
            gas: '100000000000000',
            deposit: '1',
          },
        },
      ],
    });
  });

  it('refuses a supply larger than the balance, and asks an unregistered account to register first', async () => {
    const poor = rpc({
      [`${RHEA_LENDING_CONTRACT}:get_asset`]: USDC_ASSET,
      [`${USDC}:ft_balance_of`]: '1000',
      [`${RHEA_LENDING_CONTRACT}:storage_balance_of`]: registered,
    });
    await expect(
      createRheaLending(RPC, poor.fetcher).prepareSupply({
        network: 'near:mainnet',
        accountId: OWNER,
        tokenId: USDC,
        amount: 25_000_000n,
      }),
    ).rejects.toThrow('Insufficient token balance');

    const fresh = rpc({
      [`${RHEA_LENDING_CONTRACT}:get_asset`]: USDC_ASSET,
      [`${USDC}:ft_balance_of`]: '50000000',
      [`${RHEA_LENDING_CONTRACT}:storage_balance_of`]: null,
    });
    await expect(
      createRheaLending(RPC, fresh.fetcher).prepareSupply({
        network: 'near:mainnet',
        accountId: OWNER,
        tokenId: USDC,
        amount: 25_000_000n,
      }),
    ).rejects.toBeInstanceOf(RheaRegistrationRequired);
  });

  it('registers with exactly the contract minimum, and only when the account has no storage', async () => {
    const fresh = rpc({
      [`${RHEA_LENDING_CONTRACT}:storage_balance_of`]: null,
      [`${RHEA_LENDING_CONTRACT}:storage_balance_bounds`]: { min: '100000000000000000000000', max: null },
    });
    expect(await createRheaLending(RPC, fresh.fetcher).registration(OWNER)).toEqual({
      registered: false,
      transaction: {
        receiverId: RHEA_LENDING_CONTRACT,
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: 'storage_deposit',
              args: { account_id: OWNER },
              gas: '30000000000000',
              deposit: '100000000000000000000000',
            },
          },
        ],
      },
    });

    const existing = rpc({
      [`${RHEA_LENDING_CONTRACT}:storage_balance_of`]: registered,
      [`${RHEA_LENDING_CONTRACT}:storage_balance_bounds`]: { min: '100000000000000000000000', max: null },
    });
    expect(await createRheaLending(RPC, existing.fetcher).registration(OWNER)).toEqual({
      registered: true,
      transaction: null,
    });
  });

  it('refuses an RPC endpoint that is not plain HTTPS', () => {
    expect(() => createRheaLending('http://rpc.example')).toThrow();
    expect(() => createRheaLending('https://user:pass@rpc.example')).toThrow();
  });
});
