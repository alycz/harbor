import { describe, expect, it } from 'vitest';

import { createOneClickClient } from '../src/oneclick/client.ts';
import {
  base58Decode,
  base58Encode,
  oneClickQuoteHash,
  stableStringify,
  verifyOneClickQuoteSignature,
} from '../src/oneclick/signature.ts';
// A dry NEAR to USDC quote recorded from the live 1Click API, signed by its manager key.
import recorded from './fixtures/oneclick-dry-quote.json';

function copy(): typeof recorded {
  return structuredClone(recorded);
}

describe('1Click quote signatures', () => {
  it('verifies a recorded live quote with WebCrypto ed25519', async () => {
    expect(await oneClickQuoteHash(recorded)).toBe('2XT5SmL31KQm1nBVjb7kVe1zLUdqr1k8NzoutYnqFJAi');
    expect(await verifyOneClickQuoteSignature(recorded)).toBe(true);
  });

  it('rejects any change to a signed field', async () => {
    const lowerMinimum = copy();
    lowerMinimum.quote.minAmountOut = '1';
    const otherRecipient = copy();
    otherRecipient.quoteRequest.recipient = 'mallory.near';
    const otherTime = copy();
    otherTime.timestamp = '2026-11-03T21:28:13.266Z';
    for (const tampered of [lowerMinimum, otherRecipient, otherTime]) {
      expect(await verifyOneClickQuoteSignature(tampered)).toBe(false);
    }
  });

  it('fails closed on a malformed signature, key or response', async () => {
    expect(await verifyOneClickQuoteSignature({ ...copy(), signature: 'ed25519:0OIl' })).toBe(false);
    expect(await verifyOneClickQuoteSignature({ ...copy(), signature: 42 })).toBe(false);
    expect(await verifyOneClickQuoteSignature(recorded, 'ed25519:11111111111111111111111111111111')).toBe(false);
    expect(await verifyOneClickQuoteSignature(null)).toBe(false);
    expect(await verifyOneClickQuoteSignature({ quote: [], quoteRequest: {} })).toBe(false);
  });

  it('lets the client accept the recorded quote with the default verifier', async () => {
    const client = createOneClickClient({
      fetch: async () => Response.json(recorded),
    });
    const { quoteRequest } = recorded;
    const verified = await client.quote({
      dry: quoteRequest.dry,
      swapType: 'EXACT_INPUT',
      slippageTolerance: quoteRequest.slippageTolerance,
      originAsset: quoteRequest.originAsset,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: quoteRequest.destinationAsset,
      amount: quoteRequest.amount,
      refundTo: quoteRequest.refundTo,
      refundType: 'ORIGIN_CHAIN',
      recipient: quoteRequest.recipient,
      recipientType: 'DESTINATION_CHAIN',
      deadline: quoteRequest.deadline,
    });
    expect(verified.quoteHash).toBe('2XT5SmL31KQm1nBVjb7kVe1zLUdqr1k8NzoutYnqFJAi');
    expect(verified.response.quote.minAmountOut).toBe(recorded.quote.minAmountOut);
  });
});

describe('stableStringify', () => {
  it('sorts keys and skips undefined object values', () => {
    expect(stableStringify({ b: 1, a: 'x', c: undefined, d: [1, undefined] })).toBe('{"a":"x","b":1,"d":[1,null]}');
  });

  it('rejects values JSON cannot carry', () => {
    expect(() => stableStringify({ a: Number.NaN })).toThrow();
    expect(() => stableStringify({ a: 1n })).toThrow();
  });
});

describe('base58', () => {
  it('round-trips bytes, including leading zeros', () => {
    const bytes = new Uint8Array([0, 0, 1, 2, 255, 128]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    expect(base58Encode(new Uint8Array([0]))).toBe('1');
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base58Decode('0OIl')).toThrow();
    expect(() => base58Decode('')).toThrow();
  });
});
