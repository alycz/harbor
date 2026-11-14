import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { leashAvailable } from '../src/autopilot/leash-dispatch.ts';
import { sessionCookie } from './session.ts';

afterEach(() => vi.restoreAllMocks());
describe('Leash dispatch admission', () => {
  it('requires a wallet session for approval, submission and recovery', async () => {
    for (const [path, method] of [
      ['approve', 'POST'],
      ['executions/abcd1234/submit', 'POST'],
      ['executions/abcd1234', 'GET'],
    ] as const) {
      const r = await createApp().request(`https://harbor.test/api/leash/${path}`, { method }, env);
      expect(r.status).toBe(401);
    }
  });
  it('does not dispatch without explicit signer binding and all execution gates', async () => {
    const cookie = await sessionCookie('dispatch.near');
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const path of ['approve', 'executions/abcd1234/submit']) {
      const r = await createApp().request(
        `https://harbor.test/api/leash/${path}`,
        { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' },
        env,
      );
      expect(r.status).toBe(409);
    }
    expect(fetch).not.toHaveBeenCalled();
    const configured = {
      ...env,
      NEAR_NETWORK: 'mainnet',
      EXECUTION_ENABLED: 'true',
      ENABLED_WRITE_ADAPTERS: 'oneclick',
      LEASH_EXECUTION_ENABLED: 'true',
      LEASH_SIGNER: { fetch },
      LEASH_CONTRACT_CODE_HASH: '1'.repeat(44),
    };
    expect(leashAvailable(configured)).toBe(true);
    expect(leashAvailable({ ...configured, LEASH_SIGNER: undefined })).toBe(false);
    expect(leashAvailable({ ...configured, LEASH_CONTRACT_CODE_HASH: undefined })).toBe(false);
    expect(leashAvailable({ ...configured, EXECUTION_ENABLED: 'false' })).toBe(false);
    expect(leashAvailable({ ...configured, ENABLED_WRITE_ADAPTERS: '' })).toBe(false);
  });
  it('never reveals another owner approval or queries a signer for it', async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO leash_approvals(id,owner,request_json,quote_response,created_at_ms) VALUES(?,?,?,?,?)',
    )
      .bind(id, 'alice.near', '{}', '{}', Date.now())
      .run();
    const cookie = await sessionCookie('bob.near');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const r = await createApp().request(`https://harbor.test/api/leash/executions/${id}`, { headers: { cookie } }, env);
    expect(r.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
