import { base64Encode, KeyPair, KeyPairSigner, type Provider, PublicKey } from 'near-api-js';
import { AccessKeyDoesNotExistError } from 'near-api-js/rpc-errors';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AccessKeyLookupFailed,
  type AccessKeyReader,
  createAccessKeyReader,
  SignInRejected,
  verifySignIn,
} from '../src/sign-in.ts';

const ACCOUNT = 'alice.near';
const RPC_URL = 'https://rpc.test';
const payload = { message: 'Sign in to Harbor', recipient: 'harbor.test', nonce: new Uint8Array(32).fill(7) };

async function signed(overrides: Partial<typeof payload> = {}) {
  const keyPair = KeyPair.fromRandom('ed25519');
  const result = await new KeyPairSigner(keyPair).signNep413Message(ACCOUNT, { ...payload, ...overrides });
  return {
    accountId: ACCOUNT,
    publicKey: result.publicKey.toString(),
    signature: base64Encode(result.signature),
    ...payload,
  };
}

function reader(permission: unknown): AccessKeyReader {
  return { viewAccessKey: async () => ({ permission }) as Awaited<ReturnType<Provider['viewAccessKey']>> };
}

const FULL_ACCESS = reader('FullAccess');

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SignInRejected);
  return (error as SignInRejected).reason;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifySignIn', () => {
  it('accepts a real NEP-413 signature by a full-access key', async () => {
    await expect(verifySignIn(await signed(), FULL_ACCESS)).resolves.toBeUndefined();
  });

  it('rejects a signature over a different message, nonce or recipient', async () => {
    for (const overrides of [
      { message: 'Send all funds' },
      { recipient: 'attacker.test' },
      { nonce: new Uint8Array(32).fill(8) },
    ]) {
      expect(await rejection(verifySignIn(await signed(overrides), FULL_ACCESS))).toBe('BAD_SIGNATURE');
    }
  });

  it('rejects a function-call key, even with a valid signature', async () => {
    const limited = reader({ FunctionCall: { allowance: null, receiver_id: 'app.near', method_names: [] } });
    expect(await rejection(verifySignIn(await signed(), limited))).toBe('NOT_FULL_ACCESS');
  });

  it('rejects a key the account does not have', async () => {
    const missing: AccessKeyReader = {
      viewAccessKey: async ({ publicKey }) => {
        throw new AccessKeyDoesNotExistError(PublicKey.from(publicKey), 'block-hash', 1);
      },
    };
    expect(await rejection(verifySignIn(await signed(), missing))).toBe('UNKNOWN_KEY');
  });

  it('rejects malformed input before asking the chain', async () => {
    const view = vi.fn();
    const keys = { viewAccessKey: view } as unknown as AccessKeyReader;
    const good = await signed();
    for (const bad of [
      { ...good, signature: 'not base64!' },
      { ...good, signature: base64Encode(new Uint8Array(63)) },
      { ...good, publicKey: 'secp256k1:abc' },
      { ...good, nonce: new Uint8Array(31) },
    ]) {
      expect(await rejection(verifySignIn(bad, keys))).toBe('MALFORMED');
    }
    expect(view).not.toHaveBeenCalled();
  });

  it('reports an unreachable chain as a lookup failure, never as a rejection', async () => {
    const down: AccessKeyReader = {
      viewAccessKey: async () => {
        throw new Error('network down');
      },
    };
    await expect(verifySignIn(await signed(), down)).rejects.toBeInstanceOf(AccessKeyLookupFailed);
  });
});

describe('createAccessKeyReader', () => {
  /** Responses recorded from a mainnet RPC. */
  const rpcResult = (result: Record<string, unknown>) =>
    Response.json({
      jsonrpc: '2.0',
      id: 'harbor',
      result: { block_hash: '3obVm2rW7uHZNdXU8NUYTTUQY5uyjYf6BN5X6NyuNfwN', block_height: 222930526, ...result },
    });

  it('reads a recorded full-access key through the real provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      rpcResult({ nonce: 196139067000000, permission: 'FullAccess' }),
    );
    await expect(verifySignIn(await signed(), createAccessKeyReader(RPC_URL))).resolves.toBeUndefined();
  });

  it('rejects a recorded function-call key', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      rpcResult({
        nonce: 222789655000157,
        permission: { FunctionCall: { allowance: null, method_names: ['call'], receiver_id: 'aurora' } },
      }),
    );
    expect(await rejection(verifySignIn(await signed(), createAccessKeyReader(RPC_URL)))).toBe('NOT_FULL_ACCESS');
  });

  it('rejects the recorded answer for a key that does not exist', async () => {
    const input = await signed();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      rpcResult({ error: `access key ${input.publicKey} does not exist while viewing`, logs: [] }),
    );
    expect(await rejection(verifySignIn(input, createAccessKeyReader(RPC_URL)))).toBe('UNKNOWN_KEY');
  });
});
