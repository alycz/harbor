import type { AssetRef } from './asset.ts';
import { NEAR_DECIMALS } from './near.ts';

/**
 * The assets Harbor swaps, checked against 1Click's token list on 2026-11-04. 1Click represents
 * native NEAR with the wrap.near asset ID. It has no testnet, so these exist on mainnet only.
 * Bitcoin is left out: its quotes did not pass signature verification on 2026-11-04.
 */
export const ONE_CLICK_ASSETS: readonly AssetRef[] = [
  {
    network: 'mainnet',
    canonicalId: 'nep141:wrap.near',
    symbol: 'NEAR',
    name: 'NEAR',
    chain: 'near',
    decimals: NEAR_DECIMALS,
  },
  {
    network: 'mainnet',
    canonicalId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    symbol: 'USDC',
    name: 'USD Coin on NEAR',
    chain: 'near',
    decimals: 6,
  },
  {
    network: 'mainnet',
    canonicalId: 'nep141:usdt.tether-token.near',
    symbol: 'USDT',
    name: 'Tether USD on NEAR',
    chain: 'near',
    decimals: 6,
  },
  {
    network: 'mainnet',
    canonicalId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    symbol: 'USDC.arb',
    name: 'USD Coin on Arbitrum',
    chain: 'arb',
    decimals: 6,
  },
  {
    network: 'mainnet',
    canonicalId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    symbol: 'USDC.base',
    name: 'USD Coin on Base',
    chain: 'base',
    decimals: 6,
  },
  {
    network: 'mainnet',
    canonicalId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
    symbol: 'USDC.eth',
    name: 'USD Coin on Ethereum',
    chain: 'eth',
    decimals: 6,
  },
  {
    network: 'mainnet',
    canonicalId: 'nep141:eth.omft.near',
    symbol: 'ETH',
    name: 'Ether on Ethereum',
    chain: 'eth',
    decimals: 18,
  },
  {
    network: 'mainnet',
    canonicalId: 'nep141:sol.omft.near',
    symbol: 'SOL',
    name: 'Solana',
    chain: 'sol',
    decimals: 9,
  },
];
