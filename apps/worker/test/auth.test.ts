import { env } from 'cloudflare:workers';
import { base58Encode } from '@harbor/adapters/oneclick/signature';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.ts';

const ORIGIN = 'https://harbor.test';
const RECIPIENT = 'harbor.test';
const ACCOUNT = 'alice.near';
const NEP413_TAG = 2 ** 31 + 413;
const HASH = '3obVm2rW7uHZNdXU8NUYTTUQY5uyjYf6BN5X6NyuNfwN';

/** An independent NEP-413 signer, written from the spec, so these tests also pin the wire format. */
async function createWallet() {
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer;
  return {
    publicKey: `ed25519:${base58Encode(new Uint8Array(raw))}`,
    async sign(message: string, recipient: string, nonceBase64: string) {
      const nonce = Uint8Array.from(atob(nonceBase64), (character) => character.charCodeAt(0));
      const payload = concat(u32(NEP413_TAG), text(message), nonce, text(recipient), new Uint8Array([0]));
      const digest = await crypto.subtle.digest('SHA-256', payload);
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, digest);
      return btoa(String.fromCharCode(...new Uint8Array(signature)));
    },
  };
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function text(value: string) {
  const bytes = new TextEncoder().encode(value);
  return concat(u32(bytes.length), bytes);
}

function concat(...parts: Uint8Array[]) {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

/** Answers the provider's view_access_key with responses recorded from a mainnet RPC. */
function chainSays(result: Record<string, unknown> | 'down') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (result === 'down') throw new Error('network down');
    return Response.json({
      jsonrpc: '2.0',
      id: 'harbor',
      result: { block_hash: HASH, block_height: 222930526, ...result },
    });
  });
}
const FULL_ACCESS = { nonce: 196139067000000, permission: 'FullAccess' };
const FUNCTION_CALL = {
  nonce: 222789655000157,
  permission: { FunctionCall: { allowance: null, method_names: ['call'], receiver_id: 'aurora' } },
};

function post(path: string, body: unknown, cookie = '') {
  return createApp().request(
    `${ORIGIN}/api/auth${path}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    },
    env,
  );
}

function cookiesOf(response: Response) {
  return response.headers
    .getSetCookie()
    .filter((line) => !line.includes('Max-Age=0'))
    .map((line) => line.split(';')[0])
    .join('; ');
}

interface Challenge {
  nonce: string;
  message: string;
  recipient: string;
}

async function challengeFor(accountId = ACCOUNT) {
  const response = await post('/challenge', { accountId });
  expect(response.status).toBe(201);
  return { challenge: await response.json<Challenge>(), cookie: cookiesOf(response) };
}

async function signIn(wallet: Awaited<ReturnType<typeof createWallet>>, accountId = ACCOUNT) {
  const { challenge, cookie } = await challengeFor(accountId);
  const signature = await wallet.sign(challenge.message, challenge.recipient, challenge.nonce);
  return {
    response: await post(
      '/verify',
      { accountId, publicKey: wallet.publicKey, signature, nonce: challenge.nonce },
      cookie,
    ),
    challenge,
    cookie,
    signature,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sign-in', () => {
  it('opens a session for a real signature by a full-access key', async () => {
    chainSays(FULL_ACCESS);
    const { response } = await signIn(await createWallet());
    expect(response.status).toBe(200);
    const body = await response.json<{ session: { accountId: string; network: string } }>();
    expect(body.session).toMatchObject({ accountId: ACCOUNT, network: 'mainnet' });

    const line = response.headers.getSetCookie().find((cookie) => cookie.startsWith('harbor_session='));
    expect(line).toMatch(/HttpOnly/);
    expect(line).toMatch(/Secure/);
    expect(line).toMatch(/SameSite=Lax/);

    const session = await createApp().request(
      `${ORIGIN}/api/auth/session`,
      { headers: { cookie: cookiesOf(response) } },
      env,
    );
    expect(await session.json()).toMatchObject({ session: { accountId: ACCOUNT } });
  });

  it('signs the host as recipient and tells the user that signing moves nothing', async () => {
    const { challenge } = await challengeFor();
    expect(challenge.recipient).toBe(RECIPIENT);
    expect(challenge.message).toContain(ACCOUNT);
    expect(challenge.message).toContain('cannot move funds');
  });

  it('never stores the session token', async () => {
    chainSays(FULL_ACCESS);
    const { response } = await signIn(await createWallet(), 'stores.near');
    const token = cookiesOf(response).split('harbor_session=')[1] ?? '';
    const { results } = await env.DB.prepare('SELECT id FROM auth_sessions').all<{ id: string }>();
    expect(token).not.toBe('');
    expect(results.some((row) => row.id === token)).toBe(false);
  });

  it('refuses to replay a nonce, even with the same valid signature', async () => {
    chainSays(FULL_ACCESS);
    const wallet = await createWallet();
    const { response, challenge, cookie, signature } = await signIn(wallet);
    expect(response.status).toBe(200);
    const replay = await post(
      '/verify',
      { accountId: ACCOUNT, publicKey: wallet.publicKey, signature, nonce: challenge.nonce },
      cookie,
    );
    expect(replay.status).toBe(401);
  });

  it('burns the nonce on a failed attempt', async () => {
    chainSays(FULL_ACCESS);
    const wallet = await createWallet();
    const { challenge, cookie } = await challengeFor();
    const wrong = await wallet.sign('Something else', challenge.recipient, challenge.nonce);
    const first = await post(
      '/verify',
      { accountId: ACCOUNT, publicKey: wallet.publicKey, signature: wrong, nonce: challenge.nonce },
      cookie,
    );
    expect(first.status).toBe(401);
    const right = await wallet.sign(challenge.message, challenge.recipient, challenge.nonce);
    const second = await post(
      '/verify',
      { accountId: ACCOUNT, publicKey: wallet.publicKey, signature: right, nonce: challenge.nonce },
      cookie,
    );
    expect(second.status).toBe(401);
  });

  it('refuses a signature made for another site', async () => {
    chainSays(FULL_ACCESS);
    const wallet = await createWallet();
    const { challenge, cookie } = await challengeFor();
    const signature = await wallet.sign(challenge.message, 'attacker.example', challenge.nonce);
    const response = await post(
      '/verify',
      { accountId: ACCOUNT, publicKey: wallet.publicKey, signature, nonce: challenge.nonce },
      cookie,
    );
    expect(response.status).toBe(401);
  });

  it('refuses a challenge completed from another browser or for another account', async () => {
    chainSays(FULL_ACCESS);
    const wallet = await createWallet();
    const { challenge, cookie } = await challengeFor();
    const signature = await wallet.sign(challenge.message, challenge.recipient, challenge.nonce);
    const body = { accountId: ACCOUNT, publicKey: wallet.publicKey, signature, nonce: challenge.nonce };
    expect((await post('/verify', body)).status).toBe(401);
    expect((await post('/verify', body, 'harbor_sign_in=stolen')).status).toBe(401);
    expect((await post('/verify', { ...body, accountId: 'bob.near' }, cookie)).status).toBe(401);
  });

  it('refuses a function-call key and a key the account does not have', async () => {
    const limited = chainSays(FUNCTION_CALL);
    const { response } = await signIn(await createWallet());
    expect(response.status).toBe(401);
    expect(await response.text()).toContain('full-access');
    limited.mockRestore();

    const wallet = await createWallet();
    chainSays({ error: `access key ${wallet.publicKey} does not exist while viewing`, logs: [] });
    const missing = await signIn(wallet);
    expect(missing.response.status).toBe(401);
    expect(await missing.response.text()).toContain('does not belong');
  });

  it('reports an unreachable chain as unavailable, not as a bad signature', async () => {
    chainSays('down');
    const { response } = await signIn(await createWallet());
    expect(response.status).toBe(503);
  });

  it('refuses malformed input and accounts on the other network', async () => {
    expect((await post('/challenge', { accountId: 'Not An Account' })).status).toBe(400);
    expect((await post('/challenge', { accountId: 'alice.testnet' })).status).toBe(400);
    expect((await post('/challenge', {})).status).toBe(400);
    expect((await post('/verify', { accountId: ACCOUNT })).status).toBe(400);
  });
});

describe('sessions', () => {
  it('report no session without a valid cookie', async () => {
    for (const headers of [{}, { cookie: 'harbor_session=not-a-real-token' }]) {
      const response = await createApp().request(`${ORIGIN}/api/auth/session`, { headers }, env);
      expect(await response.json()).toEqual({ session: null });
    }
  });

  it('end on logout, and the old cookie no longer works', async () => {
    chainSays(FULL_ACCESS);
    const { response } = await signIn(await createWallet());
    const cookie = cookiesOf(response);
    expect((await post('/logout', {}, cookie)).status).toBe(200);
    const after = await createApp().request(`${ORIGIN}/api/auth/session`, { headers: { cookie } }, env);
    expect(await after.json()).toEqual({ session: null });
  });
});
