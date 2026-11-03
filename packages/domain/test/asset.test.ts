import { describe, expect, it } from 'vitest';

import { AmountSchema, AssetRefSchema } from '../src/asset.ts';

describe('AssetRefSchema', () => {
  it('accepts a registry-verified asset', () => {
    const asset = AssetRefSchema.parse({ network: 'mainnet', canonicalId: 'wrap.near', symbol: 'wNEAR', decimals: 24 });
    expect(asset.decimals).toBe(24);
  });

  it('rejects unknown fields, unknown networks and bad decimals', () => {
    expect(() =>
      AssetRefSchema.parse({
        network: 'mainnet',
        canonicalId: 'wrap.near',
        symbol: 'wNEAR',
        decimals: 24,
        ticker: 'N',
      }),
    ).toThrow();
    expect(() => AssetRefSchema.parse({ network: 'devnet', canonicalId: 'x', symbol: 'X', decimals: 6 })).toThrow();
    expect(() => AssetRefSchema.parse({ network: 'mainnet', canonicalId: 'x', symbol: 'X', decimals: 39 })).toThrow();
  });
});

describe('AmountSchema', () => {
  it('requires a canonical raw integer string', () => {
    const asset = { network: 'testnet', canonicalId: 'usdc.testnet', symbol: 'USDC', decimals: 6 };
    expect(AmountSchema.parse({ asset, amountRaw: '1000000' }).amountRaw).toBe('1000000');
    for (const amountRaw of ['1.5', '-1', '01', '1e7', '']) {
      expect(() => AmountSchema.parse({ asset, amountRaw })).toThrow();
    }
  });
});
