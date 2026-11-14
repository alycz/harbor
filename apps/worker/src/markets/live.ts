import { createRheaReader } from '@harbor/adapters/rhea/lending';
import type { AssetRef } from '@harbor/domain/asset';
import { parseOneClickAssetId } from '@harbor/domain/asset';
import { z } from 'zod';

/**
 * Live figures for the opportunities Harbor can deposit into, read when asked rather than from the dated
 * research snapshot. Each source is read on its own, so one failure leaves the others standing.
 */
export interface LiveEarn {
  fetchedAt: string;
  rhea: LiveRheaMarket[];
  vaults: LiveVault[];
}

interface LiveRheaMarket {
  /** The registry asset a supply uses: its canonical 1Click ID, symbol and decimals. */
  assetId: string;
  symbol: string;
  tokenId: string;
  supplyAprPct: number;
  /** Total supplied, in whole tokens. */
  supplied: number;
  canDeposit: boolean;
  canWithdraw: boolean;
}

interface LiveVault {
  /** The receipt token Harbor buys through 1Click to deposit. */
  receipt: string;
  apyPct: number;
  tvlUsd: number;
  source: { name: string; url: string };
}

/** Morpho's Gauntlet USDC Prime on Base: the vault behind 1Click's NEAR Gauntlet USDC Prime receipt token. */
const GAUNTLET_UNDERLYING = '0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61';
/** Taler's TAU Lending Optimizer on Ethereum: 1Click's TLO receipt token is this contract. */
const TALER_VAULT = '0x0f38f1ce62776d4a0038bc6cac66877a5687383b';

const MorphoVault = z.object({
  data: z.object({
    vaultByAddress: z.object({
      state: z.object({ totalAssetsUsd: z.number().nonnegative(), netApy: z.number() }),
    }),
  }),
});

async function getJson(fetcher: typeof fetch, url: string, init: RequestInit = {}) {
  const response = await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response;
}

async function gauntlet(fetcher: typeof fetch): Promise<LiveVault> {
  const query = `query { vaultByAddress(address: "${GAUNTLET_UNDERLYING}", chainId: 8453) { state { totalAssetsUsd netApy } } }`;
  const response = await getJson(fetcher, 'https://blue-api.morpho.org/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const { state } = MorphoVault.parse(await response.json()).data.vaultByAddress;
  return {
    receipt: 'gtUSDCp',
    apyPct: state.netApy * 100,
    tvlUsd: state.totalAssetsUsd,
    source: { name: 'Morpho', url: `https://app.morpho.org/base/vault/${GAUNTLET_UNDERLYING}` },
  };
}

async function taler(fetcher: typeof fetch): Promise<LiveVault> {
  const page = `https://explorer.portals.fi/yield/ethereum:${TALER_VAULT}`;
  const text = await (await getJson(fetcher, `${page}.md`)).text();
  const field = (name: string) => Number(text.match(new RegExp(`^${name}: "?([0-9.]+)"?$`, 'm'))?.[1]);
  const apy = field('apy');
  const tvl = field('tvl_usd');
  if (!Number.isFinite(apy) || !Number.isFinite(tvl)) throw new Error('Portals page had no APY or TVL');
  return { receipt: 'TLO', apyPct: apy * 100, tvlUsd: tvl, source: { name: 'Portals', url: page } };
}

async function rhea(rpcUrl: string, assets: readonly AssetRef[], fetcher: typeof fetch): Promise<LiveRheaMarket[]> {
  const reader = createRheaReader(rpcUrl, fetcher);
  const near = assets.flatMap((asset) => {
    const identity = asset.chain === 'near' ? parseOneClickAssetId(asset.canonicalId) : null;
    return identity?.standard === 'nep141' ? [{ asset, tokenId: identity.contractId }] : [];
  });
  const markets = await Promise.allSettled(near.map(({ tokenId }) => reader.market(tokenId)));
  return markets.flatMap((result, index) => {
    const entry = near[index];
    if (result.status !== 'fulfilled' || !entry) return [];
    const market = result.value;
    if (market.supplyAprPct === null) return [];
    // Two decimal places of whole tokens is plenty for a TVL figure.
    const supplied = Number(market.totalSuppliedRaw / 10n ** BigInt(Math.max(0, entry.asset.decimals - 2))) / 100;
    return [
      {
        assetId: entry.asset.canonicalId,
        symbol: entry.asset.symbol,
        tokenId: market.tokenId,
        supplyAprPct: market.supplyAprPct,
        supplied,
        canDeposit: market.canDeposit,
        canWithdraw: market.canWithdraw,
      },
    ];
  });
}

export async function readLiveEarn(
  rpcUrl: string,
  assets: readonly AssetRef[],
  fetcher: typeof fetch = fetch,
): Promise<LiveEarn> {
  const [rheaMarkets, ...vaults] = await Promise.allSettled([
    rhea(rpcUrl, assets, fetcher),
    gauntlet(fetcher),
    taler(fetcher),
  ]);
  return {
    fetchedAt: new Date().toISOString(),
    rhea: rheaMarkets.status === 'fulfilled' ? rheaMarkets.value : [],
    vaults: vaults.flatMap((result) => (result.status === 'fulfilled' ? [result.value as LiveVault] : [])),
  };
}
