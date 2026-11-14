import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { createWallet } from './wallet.ts';

const ACCOUNT = 'alice.near',
  MARKET = 'market.v1.tmplr.near';
let codeHash = 'code',
  cookie = '',
  timestamp = '1';
let wallet: Awaited<ReturnType<typeof createWallet>>;
function request(path: string, body: unknown) {
  return createApp().request(
    `https://harbor.test/api${path}`,
    { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) },
    { ...env, DB: env.DB, NEAR_NETWORK: 'mainnet', EXECUTION_ENABLED: 'true', ENABLED_WRITE_ADAPTERS: 'templar' },
  );
}
beforeEach(async () => {
  codeHash = 'code';
  timestamp = '1';
  cookie = '';
  wallet = await createWallet();
  await env.DB.prepare('DELETE FROM templar_borrow_plans').run();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).includes('docs.templarfi.org'))
      return new Response(`<h4>Markets listed on app.templarfi.org</h4>${MARKET}<h4>Deprecated markets</h4>`);
    const rpc = JSON.parse(String(init?.body));
    let result: unknown;
    if (rpc.method === 'block') result = { header: { hash: 'block', timestamp_nanosec: timestamp } };
    else if (rpc.method === 'tx')
      result = {
        final_execution_status: 'FINAL',
        transaction: {
          hash: 'A'.repeat(44),
          signer_id: ACCOUNT,
          receiver_id: MARKET,
          actions: [
            {
              FunctionCall: {
                method_name: 'borrow',
                args: btoa(JSON.stringify({ amount: '100' })),
                deposit: '0',
                gas: '100000000000000',
              },
            },
          ],
        },
        status: { SuccessValue: '' },
        transaction_outcome: { block_hash: 'block' },
        receipts_outcome: [{ outcome: { status: { SuccessValue: '' } } }],
      };
    else if (rpc.params.request_type === 'view_access_key')
      result = { block_hash: 'block', block_height: 1, nonce: 1, permission: 'FullAccess' };
    else if (rpc.params.request_type === 'view_account') result = { code_hash: codeHash };
    else {
      const method = rpc.params.method_name;
      const values: Record<string, unknown> = {
        get_deployment: { version_key: 'v1', code_hash: 'code', block_height: '1' },
        list_versions: ['v1'],
        get_version: { code_hash: 'code', availability: 'Global' },
        get_configuration: { borrow_asset: { Nep141: 'usdc.near' }, collateral_asset: { Nep141: 'wrap.near' } },
        storage_balance_of: { total: '1', available: '0' },
      };
      if (!(method in values)) throw new Error(`Unexpected RPC ${method}`);
      result = { result: Array.from(new TextEncoder().encode(JSON.stringify(values[method]))) };
    }
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result });
  });
  const response = await request('/auth/challenge', { accountId: ACCOUNT });
  cookie = response.headers
    .getSetCookie()
    .map((s) => s.split(';')[0])
    .join('; ');
  const challenge = await response.json<{ message: string; recipient: string; nonce: string }>();
  const signed = await wallet.sign(challenge.message, challenge.recipient, challenge.nonce);
  const login = await request('/auth/verify', {
    accountId: ACCOUNT,
    publicKey: wallet.publicKey,
    signature: signed,
    nonce: challenge.nonce,
  });
  expect(login.status, await login.clone().text()).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .filter((s) => !s.includes('Max-Age=0'))
    .map((s) => s.split(';')[0])
    .join('; ');
});
afterEach(() => vi.restoreAllMocks());
async function plan() {
  const response = await request('/templar/borrow-plans', { marketId: MARKET, amountAtomic: '100' });
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json<{
    id: string;
    digest: string;
    expiresAt: string;
    binding: { codeHash: string };
    challenge: { message: string; recipient: string; nonce: string };
  }>();
}
async function approve(p: Awaited<ReturnType<typeof plan>>) {
  return request(`/templar/borrow-plans/${p.id}/approve`, {
    digest: p.digest,
    publicKey: wallet.publicKey,
    signature: await wallet.sign(p.challenge.message, p.challenge.recipient, p.challenge.nonce),
  });
}
it('binds running code and refuses an upgrade between review and approval', async () => {
  const p = await plan();
  expect(p.binding.codeHash).toBe('code');
  codeHash = 'changed';
  const response = await approve(p);
  expect(response.status).toBe(409);
  expect(await response.text()).toContain('Market contract changed');
});
it('issues an unchanged reviewed market once only', async () => {
  const p = await plan();
  const response = await approve(p);
  expect(response.status, await response.clone().text()).toBe(200);
  expect((await approve(p)).status).toBe(409);
});
it('rejects historical matching receipts and accepts a fresh finalized borrow', async () => {
  const p = await plan();
  expect((await approve(p)).status).toBe(200);
  const path = `/templar/borrow-plans/${p.id}/receipt`;
  const body = { txHash: 'A'.repeat(44) };
  const old = await request(path, body);
  expect(old.status).toBe(409);
  expect(await old.text()).toContain('predates');
  timestamp = (BigInt(Date.parse(p.expiresAt) - 60000) * 1000000n).toString();
  const fresh = await request(path, body);
  expect(fresh.status, await fresh.clone().text()).toBe(200);
  expect(await fresh.json()).toMatchObject({ state: 'confirmed' });
});
