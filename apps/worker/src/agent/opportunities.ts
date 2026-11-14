import { createOneClickClient, type OneClickToken } from '@harbor/adapters/oneclick/client';
import { TemplarClient } from '@harbor/adapters/templar/client';

import { decodeExecutionConfig } from '../config.ts';
import { assetRegistry } from '../execution/assets.ts';
import { readLiveEarn } from '../markets/live.ts';
import { activeTemplarMarkets } from '../templar/markets.ts';
import { reader } from '../templar/routes.ts';

/** The tokens Harbor supplies to Rhea; the deposit flow checks each against the verified registry. */
const RHEA_SYMBOLS = new Set(['USDC', 'USDT']);
/** The 1Click Earn vaults: a deposit is a swap from USDC on NEAR into the receipt token. */
const VAULTS = [
  { receipt: 'gtUSDCp', name: 'Gauntlet USDC Prime', protocol: 'Morpho', chain: 'Base' },
  { receipt: 'TLO', name: 'Taler USDC', protocol: 'Taler', chain: 'Ethereum' },
] as const;
const CACHE_MS = 10 * 60_000;

export interface DepositOpportunity {
  protocol: 'rhea-lending' | 'oneclick-vault';
  name: string;
  chain: string;
  asset: string;
  ratePct: number;
  rateKind: 'APR' | 'APY';
  sizeUsd: number;
  /** Exactly how chat queues it, so the model never has to guess an identifier. */
  queueWith: string;
}

export interface BorrowAsset {
  assetId: string;
  symbol: string | null;
  blockchain: string | null;
  decimals: number | null;
}

export interface BorrowMarket {
  marketId: string;
  borrow: BorrowAsset;
  collateral: BorrowAsset;
}

export interface OpportunityService {
  deposits(): Promise<{ fetchedAt: string; opportunities: DepositOpportunity[] }>;
  borrowMarkets(): Promise<{ borrowingEnabled: boolean; markets: BorrowMarket[] }>;
}

export function createOpportunityService(env: unknown): OpportunityService {
  const config = decodeExecutionConfig(env);
  return {
    async deposits() {
      if (config.network !== 'mainnet') return { fetchedAt: new Date().toISOString(), opportunities: [] };
      const live = await readLiveEarn(config.rpcUrl, assetRegistry(config.network).list());
      const rhea = live.rhea
        .filter((market) => RHEA_SYMBOLS.has(market.symbol) && market.canDeposit)
        .map(
          (market): DepositOpportunity => ({
            protocol: 'rhea-lending',
            name: `Rhea Lend ${market.symbol}`,
            chain: 'NEAR',
            asset: market.symbol,
            ratePct: round(market.supplyAprPct),
            rateKind: 'APR',
            sizeUsd: Math.round(market.supplied),
            queueWith: `review_protocol_action { protocol: "rhea-lending", assetId: "${market.symbol}", amount: "<${market.symbol} amount>" }`,
          }),
        );
      const vaults = live.vaults.flatMap((figures): DepositOpportunity[] => {
        const vault = VAULTS.find((entry) => entry.receipt === figures.receipt);
        return vault
          ? [
              {
                protocol: 'oneclick-vault',
                name: vault.name,
                chain: vault.chain,
                asset: 'USDC',
                ratePct: round(figures.apyPct),
                rateKind: 'APY',
                sizeUsd: Math.round(figures.tvlUsd),
                queueWith: `propose_intent { sellAsset: "USDC", buyAsset: "${vault.receipt}", sellAmount: "<at least 50>" }`,
              },
            ]
          : [];
      });
      return { fetchedAt: live.fetchedAt, opportunities: [...rhea, ...vaults].sort((a, b) => b.ratePct - a.ratePct) };
    },
    borrowMarkets: () =>
      readBorrowMarkets(config.rpcUrl).then((markets) => ({
        borrowingEnabled:
          config.network === 'mainnet' && config.executionEnabled && config.writeAdapters.has('templar'),
        markets,
      })),
  };
}

let borrowCache: { at: number; value: Promise<BorrowMarket[]> } | null = null;

/** Templar's active markets with their assets named from 1Click's token list; cached per isolate. */
function readBorrowMarkets(rpcUrl: string): Promise<BorrowMarket[]> {
  if (!borrowCache || Date.now() - borrowCache.at > CACHE_MS) {
    const value = loadBorrowMarkets(rpcUrl);
    borrowCache = { at: Date.now(), value };
    value.catch(() => {
      if (borrowCache?.value === value) borrowCache = null;
    });
  }
  return borrowCache.value;
}

async function loadBorrowMarkets(rpcUrl: string): Promise<BorrowMarket[]> {
  const view = reader(rpcUrl);
  const [active, tokens] = await Promise.all([
    activeTemplarMarkets(),
    createOneClickClient({ timeoutMs: 8_000 })
      .tokens()
      .catch(() => [] as OneClickToken[]),
  ]);
  const byId = new Map(tokens.map((token) => [token.assetId, token]));
  const markets = await Promise.allSettled(
    [...active].map(async (marketId) => {
      const configuration = await new TemplarClient(view, new Set([marketId])).configuration(marketId);
      return {
        marketId,
        borrow: describe(configuration.borrow_asset, byId),
        collateral: describe(configuration.collateral_asset, byId),
      };
    }),
  );
  return markets.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

function describe(
  asset: { Nep141: string } | { Nep245: { contract_id: string; token_id: string } },
  tokens: Map<string, OneClickToken>,
): BorrowAsset {
  // Intents-held assets name their 1Click asset ID directly; a plain NEP-141 token is `nep141:<contract>`.
  const assetId = 'Nep141' in asset ? `nep141:${asset.Nep141}` : asset.Nep245.token_id;
  const token = tokens.get(assetId);
  return {
    assetId,
    symbol: token?.symbol ?? null,
    blockchain: token?.blockchain ?? null,
    decimals: token?.decimals ?? null,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
