import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.ts';
import { sessionCookie } from './session.ts';

function call(path: string, cookie = '', body?: unknown) {
  return createApp().request(
    `https://harbor.test/api/leash${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('Leash unsigned preparation boundaries', () => {
  it('requires an owner session before reading a vault or previewing a quote', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await call('/vault')).status).toBe(401);
    expect((await call('/preview', '', { quoteResponse: {} })).status).toBe(401);
    expect((await call('/quote', '', {})).status).toBe(401);
    expect((await call('/prepare-owner-action', '', { operation: 'freeze' })).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed without configured contract and agent accounts', async () => {
    const cookie = await sessionCookie('leash-config.near');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const response = await call('/vault', cookie);
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('SETUP_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unsigned quotes before making RPC requests and has no execution endpoint', async () => {
    const cookie = await sessionCookie('leash-preview.near');
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await call('/preview', cookie, { quoteResponse: {} })).status).toBe(400);
    expect((await call('/execute', cookie, {})).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Leash owner transaction construction', () => {
  it('rejects unsupported operations without chain access', async () => {
    const cookie = await sessionCookie('leash-owner.near');
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await call('/prepare-owner-action', cookie, { operation: 'execute' })).status).toBe(400);
    expect((await call('/prepare-owner-action', cookie, { operation: 'withdraw', amount: '-1' })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('constructs freeze for the session owner without signing or broadcasting', async () => {
    const cookie = await sessionCookie('leash-owner.near');
    const rpc = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const value =
        request.params.method_name === 'get_agent'
          ? 'agent.near'
          : {
              balance: '100',
              spent_today: '0',
              frozen: false,
              limits: {
                token: 'usdc.near',
                per_action: '10',
                per_day: '100',
                buy_assets: ['nep141:usdt.near'],
                recipients: ['leash-owner.near'],
                max_slippage_bps: 100,
                expires_at_ms: Date.now() + 60000,
              },
            };
      return Response.json({ result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) } });
    });
    const response = await createApp().request(
      'https://harbor.test/api/leash/prepare-owner-action',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'freeze' }),
      },
      { ...env, LEASH_CONTRACT_ID: 'leash.near', LEASH_AGENT_ACCOUNT_ID: 'agent.near' } as Env,
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      signerId: string;
      executionAvailable: boolean;
      transaction: { receiverId: string; actions: Array<{ params: { methodName: string; deposit: string } }> };
    };
    expect(result.signerId).toBe('leash-owner.near');
    expect(result.executionAvailable).toBe(false);
    expect(result.transaction.receiverId).toBe('leash.near');
    expect(result.transaction.actions[0]?.params.methodName).toBe('freeze');
    expect(result.transaction.actions[0]?.params.deposit).toBe('0');
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const [, init] of rpc.mock.calls) expect(JSON.parse(String(init?.body)).method).toBe('query');
  });
});
