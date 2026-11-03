import type { Network } from './network.ts';

/** Native NEAR and wNEAR both use 24 decimals. */
export const NEAR_DECIMALS = 24;

interface NearNetworkInfo {
  /** The chain ID NEP-413 messages and wallets use for this network. */
  chainId: Network;
  /** A public default for reads; `NEAR_RPC_URL` overrides it. */
  rpcUrl: string;
  explorerUrl: string;
}

export const NEAR_NETWORK_INFO: Record<Network, NearNetworkInfo> = {
  mainnet: { chainId: 'mainnet', rpcUrl: 'https://free.rpc.fastnear.com', explorerUrl: 'https://nearblocks.io' },
  testnet: {
    chainId: 'testnet',
    rpcUrl: 'https://test.rpc.fastnear.com',
    explorerUrl: 'https://testnet.nearblocks.io',
  },
};

export function txExplorerUrl(network: Network, txHash: string): string {
  return `${NEAR_NETWORK_INFO[network].explorerUrl}/txns/${encodeURIComponent(txHash)}`;
}
