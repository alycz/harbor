import { env } from 'cloudflare:workers';
import { NEAR_NETWORK_INFO } from '@harbor/domain/near';
import { base64Encode, KeyPair, KeyPairSigner } from 'near-api-js';
import { describe, expect, it } from 'vitest';

import { createAccessKeyReader, SignInRejected, verifySignIn } from '../src/sign-in.ts';

const reader = createAccessKeyReader(NEAR_NETWORK_INFO.mainnet.rpcUrl);
const payload = { message: 'Sign in to Harbor', recipient: 'harbor.test', nonce: new Uint8Array(32).fill(7) };

// Opt-in, because it calls a mainnet RPC: HARBOR_LIVE_NEAR=1 pnpm --filter @harbor/near test
describe.skipIf(env.HARBOR_LIVE_NEAR !== '1')('NEAR RPC live', () => {
  it('reads a real full-access key and tells it from a key the account does not have', async () => {
    const response = await fetch(NEAR_NETWORK_INFO.mainnet.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'harbor',
        method: 'query',
        params: { request_type: 'view_access_key_list', finality: 'final', account_id: 'root.near' },
      }),
    });
    const { result } = await response.json<{
      result: { keys: { public_key: string; access_key: { permission: unknown } }[] };
    }>();
    const fullAccess = result.keys.find((key) => key.access_key.permission === 'FullAccess');
    if (!fullAccess) throw new Error('root.near has no full-access key to read.');
    const key = await reader.viewAccessKey({
      accountId: 'root.near',
      publicKey: fullAccess.public_key,
      finalityQuery: { finality: 'final' },
    });
    expect(key.permission).toBe('FullAccess');
  });

  it('rejects a real signature by a key that is not on the account', async () => {
    const signed = await new KeyPairSigner(KeyPair.fromRandom('ed25519')).signNep413Message('root.near', payload);
    const error = await verifySignIn(
      {
        accountId: 'root.near',
        publicKey: signed.publicKey.toString(),
        signature: base64Encode(signed.signature),
        ...payload,
      },
      reader,
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SignInRejected);
    expect((error as SignInRejected).reason).toBe('UNKNOWN_KEY');
  });
});
