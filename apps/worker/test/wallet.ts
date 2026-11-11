import { base58Encode } from '@harbor/adapters/oneclick/signature';
import { vi } from 'vitest';

const NEP413_TAG = 2 ** 31 + 413;
const HASH = '3obVm2rW7uHZNdXU8NUYTTUQY5uyjYf6BN5X6NyuNfwN';

/** An independent NEP-413 signer, written from the spec, so these tests also pin the wire format. */
export async function createWallet() {
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
export function chainSays(result: Record<string, unknown> | 'down') {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (result === 'down') throw new Error('network down');
    return Response.json({
      jsonrpc: '2.0',
      id: 'harbor',
      result: { block_hash: HASH, block_height: 222930526, ...result },
    });
  });
}

export const FULL_ACCESS = { nonce: 196139067000000, permission: 'FullAccess' };
export const FUNCTION_CALL = {
  nonce: 222789655000157,
  permission: { FunctionCall: { allowance: null, method_names: ['call'], receiver_id: 'aurora' } },
};
