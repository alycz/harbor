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

describe('Leash read-only boundaries', () => {
  it('requires an owner session before reading a vault or previewing a quote', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect((await call('/vault')).status).toBe(401);
    expect((await call('/preview', '', { quoteResponse: {} })).status).toBe(401);
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
