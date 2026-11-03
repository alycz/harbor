import type { AssetRef } from '@harbor/domain/asset';
import type { Network } from '@harbor/domain/network';

/** The assets a network can swap, looked up by symbol or canonical ID. */
export interface AssetRegistry {
  list(): readonly AssetRef[];
  bySymbol(symbol: string): AssetRef | null;
  byId(canonicalId: string): AssetRef | null;
}

/** Verified swap assets per network. A network with none can quote nothing. */
const SWAP_ASSETS: Record<Network, readonly AssetRef[]> = {
  mainnet: [],
  testnet: [],
};

export function assetRegistry(network: Network, assets: readonly AssetRef[] = SWAP_ASSETS[network]): AssetRegistry {
  return {
    list: () => assets,
    bySymbol: (symbol) => assets.find((asset) => asset.symbol === symbol) ?? null,
    byId: (canonicalId) => assets.find((asset) => asset.canonicalId === canonicalId) ?? null,
  };
}
