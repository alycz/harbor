import { describe, expect, it } from 'vitest';

import {
  canonicalPolicyJson,
  type Policy,
  PolicySchema,
  policyDigest,
  policyMessage,
  SUGGESTED_POLICY,
} from '../src/policy.ts';

const NEAR = 'nep141:wrap.near';
const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

const signed: Policy = {
  version: 'harbor.policy.v1',
  network: 'mainnet',
  owner: 'alice.near',
  allowedAssets: [NEAR, USDC],
  spend: [{ assetId: USDC, perActionMaxRaw: '5000000', dailyMaxRaw: '10000000', totalMaxRaw: '25000000' }],
  destinations: [{ chain: 'base', address: '0x1111111111111111111111111111111111111111' }],
  slippageMaxBps: 50,
  quoteMaxAgeSeconds: 60,
  schedule: { kind: 'interval', everySeconds: 86_400 },
  validFrom: '2026-11-04T00:00:00Z',
  expiresAt: '2026-11-11T00:00:00Z',
};

describe('PolicySchema', () => {
  it('accepts a complete policy', () => {
    expect(PolicySchema.parse(signed).spend).toHaveLength(1);
  });

  it('rejects unknown fields and out-of-range values', () => {
    expect(() => PolicySchema.parse({ ...signed, maxLeverage: 3 })).toThrow();
    expect(() => PolicySchema.parse({ ...signed, slippageMaxBps: 10_001 })).toThrow();
    expect(() => PolicySchema.parse({ ...signed, slippageMaxBps: 0.5 })).toThrow();
    expect(() => PolicySchema.parse({ ...signed, schedule: { kind: 'interval', everySeconds: 1 } })).toThrow();
    const negative = { ...signed.spend[0], totalMaxRaw: '-1' };
    expect(() => PolicySchema.parse({ ...signed, spend: [negative] })).toThrow();
  });

  it('requires an asset and a spend limit', () => {
    expect(() => PolicySchema.parse({ ...signed, allowedAssets: [] })).toThrow();
    expect(() => PolicySchema.parse({ ...signed, spend: [] })).toThrow();
  });

  it('rejects a policy that expires before it starts or lasts over 90 days', () => {
    expect(() => PolicySchema.parse({ ...signed, expiresAt: signed.validFrom })).toThrow(/expire after it starts/);
    expect(() => PolicySchema.parse({ ...signed, expiresAt: '2027-03-01T00:00:00Z' })).toThrow(/90 days/);
  });

  it('rejects limits on assets the policy does not allow, and limits above the total', () => {
    const elsewhere = { ...signed.spend[0], assetId: 'nep141:other.near' };
    expect(() => PolicySchema.parse({ ...signed, spend: [elsewhere] })).toThrow(/allowed asset/);
    const tooMuch = { ...signed.spend[0], perActionMaxRaw: '30000000' };
    expect(() => PolicySchema.parse({ ...signed, spend: [tooMuch] })).toThrow(/per-action/);
  });
});

describe('policy digest', () => {
  it('does not depend on key order, and changes with any limit', async () => {
    const reordered = Object.fromEntries(Object.entries(signed).reverse()) as Policy;
    expect(canonicalPolicyJson(reordered)).toBe(canonicalPolicyJson(signed));
    expect(await policyDigest(reordered)).toBe(await policyDigest(signed));
    const looser = { ...signed, slippageMaxBps: 100 };
    expect(await policyDigest(looser)).not.toBe(await policyDigest(signed));
    expect(await policyDigest(signed)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('puts the limits in words and the digest in the message the wallet shows', async () => {
    const digest = await policyDigest(signed);
    const symbols: Record<string, string> = { [NEAR]: 'NEAR', [USDC]: 'USDC' };
    const message = policyMessage(signed, digest, 3, (assetId) => ({
      symbol: symbols[assetId] ?? assetId,
      format: (raw) => (Number(raw) / 1e6).toString(),
    }));
    expect(message).toContain('Sign Harbor policy #3 for alice.near on NEAR mainnet.');
    expect(message).toContain('USDC: up to 5 per action, 10 per day, 25 in total');
    expect(message).toContain('alice.near (near), 0x1111111111111111111111111111111111111111 (base)');
    expect(message).toContain('at most once every day');
    expect(message).toContain(`Policy digest: ${digest}`);
    expect(message).toContain('moves no funds');
  });
});

describe('SUGGESTED_POLICY', () => {
  it('is marked suggested and is not a signable policy on its own', () => {
    expect(SUGGESTED_POLICY.status).toBe('suggested');
    expect(PolicySchema.safeParse(SUGGESTED_POLICY.values).success).toBe(false);
  });
});
