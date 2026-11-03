import { describe, expect, it } from 'vitest';

import { PolicySchema, SUGGESTED_POLICY } from '../src/policy.ts';

const NEAR = 'nep141:wrap.near';
const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

const signed = {
  version: 'harbor.policy.v1',
  network: 'mainnet',
  owner: 'alice.near',
  allowedAssets: [NEAR, USDC],
  destinations: [{ chain: 'near', address: 'alice.near' }],
  budget: { assetId: USDC, maxRaw: '25000000' },
  perActionCap: { assetId: USDC, maxRaw: '5000000' },
  dailyCap: null,
  slippageBps: 50,
  priceImpactWarningBps: 100,
  quoteMaxAgeSeconds: 30,
  schedule: { kind: 'interval', everySeconds: 86_400 },
  validFrom: '2026-11-04T00:00:00Z',
  expiresAt: '2026-11-11T00:00:00Z',
};

describe('PolicySchema', () => {
  it('accepts a complete policy and keeps disabled caps as null', () => {
    expect(PolicySchema.parse(signed).dailyCap).toBeNull();
  });

  it('rejects unknown fields and out-of-range values', () => {
    expect(() => PolicySchema.parse({ ...signed, maxLeverage: 3 })).toThrow();
    expect(() => PolicySchema.parse({ ...signed, slippageBps: 10_001 })).toThrow();
    expect(() => PolicySchema.parse({ ...signed, slippageBps: 0.5 })).toThrow();
    expect(() => PolicySchema.parse({ ...signed, budget: { assetId: USDC, maxRaw: '-1' } })).toThrow();
    expect(() => PolicySchema.parse({ ...signed, schedule: { kind: 'interval', everySeconds: 1 } })).toThrow();
  });

  it('requires at least one destination and one asset', () => {
    expect(() => PolicySchema.parse({ ...signed, destinations: [] })).toThrow();
    expect(() => PolicySchema.parse({ ...signed, allowedAssets: [] })).toThrow();
  });

  it('rejects a policy that expires before it starts', () => {
    expect(() => PolicySchema.parse({ ...signed, expiresAt: signed.validFrom })).toThrow(/expire after it starts/);
  });

  it('rejects caps on assets the policy does not allow', () => {
    expect(() =>
      PolicySchema.parse({ ...signed, perActionCap: { assetId: 'nep141:other.near', maxRaw: '1' } }),
    ).toThrow(/allowed asset/);
  });
});

describe('SUGGESTED_POLICY', () => {
  it('is marked suggested and is not a signable policy on its own', () => {
    expect(SUGGESTED_POLICY.status).toBe('suggested');
    expect(PolicySchema.safeParse(SUGGESTED_POLICY.values).success).toBe(false);
  });
});
