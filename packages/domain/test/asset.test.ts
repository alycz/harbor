import { describe, expect, it } from 'vitest';

import { AmountSchema, AssetRefSchema, OneClickAssetIdSchema, parseOneClickAssetId } from '../src/asset.ts';
import { ONE_CLICK_ASSETS } from '../src/oneclick-assets.ts';

const USDC = {
  network: 'mainnet',
  canonicalId: 'nep141:usdc.near',
  symbol: 'USDC',
  name: 'USD Coin',
  chain: 'near',
  decimals: 6,
};

describe('AssetRefSchema', () => {
  it('accepts a registry-verified asset', () => {
    expect(AssetRefSchema.parse(USDC).decimals).toBe(6);
  });

  it('rejects unknown fields, unknown networks and bad decimals', () => {
    expect(() => AssetRefSchema.parse({ ...USDC, ticker: 'N' })).toThrow();
    expect(() => AssetRefSchema.parse({ ...USDC, network: 'devnet' })).toThrow();
    expect(() => AssetRefSchema.parse({ ...USDC, decimals: 39 })).toThrow();
    expect(() => AssetRefSchema.parse({ ...USDC, symbol: 'not a symbol' })).toThrow();
  });
});

describe('AmountSchema', () => {
  it('requires a canonical raw integer string', () => {
    expect(AmountSchema.parse({ asset: USDC, amountRaw: '1000000' }).amountRaw).toBe('1000000');
    for (const amountRaw of ['1.5', '-1', '01', '1e7', '']) {
      expect(() => AmountSchema.parse({ asset: USDC, amountRaw })).toThrow();
    }
  });
});

describe('1Click asset IDs', () => {
  it('parses fungible and multi-token IDs', () => {
    expect(parseOneClickAssetId('nep141:wrap.near')).toEqual({ standard: 'nep141', contractId: 'wrap.near' });
    expect(parseOneClickAssetId('nep245:v2_1.omni.hot.tg:56_abc')).toEqual({
      standard: 'nep245',
      contractId: 'v2_1.omni.hot.tg',
      tokenId: '56_abc',
    });
  });

  it('rejects tickers and other namespaces', () => {
    for (const id of ['USDC', 'wrap.near', 'nep141:', 'nep171:x.near', 'nep245:only-contract']) {
      expect(parseOneClickAssetId(id)).toBeNull();
    }
    expect(OneClickAssetIdSchema.safeParse('USDC').success).toBe(false);
    expect(OneClickAssetIdSchema.safeParse('nep141:wrap.near').success).toBe(true);
  });
});

describe('ONE_CLICK_ASSETS', () => {
  it('holds valid, uniquely identified mainnet assets', () => {
    for (const asset of ONE_CLICK_ASSETS) {
      expect(AssetRefSchema.parse(asset).network).toBe('mainnet');
      expect(parseOneClickAssetId(asset.canonicalId)).not.toBeNull();
    }
    expect(new Set(ONE_CLICK_ASSETS.map((asset) => asset.symbol)).size).toBe(ONE_CLICK_ASSETS.length);
    expect(new Set(ONE_CLICK_ASSETS.map((asset) => asset.canonicalId)).size).toBe(ONE_CLICK_ASSETS.length);
  });
});
