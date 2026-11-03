import { z } from 'zod';

const NUMBER_OR_NULL = z.number().finite().nullable();
const HTTP_URL = z.url().refine((value) => /^https?:\/\//i.test(value));
const SourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: HTTP_URL,
  attribution: z.string(),
  captured_at: z.iso.datetime(),
  live: z.literal(false),
});
const SnapshotSchema = z.object({
  schema_version: z.literal('harbor.research.v1'),
  live: z.literal(false),
  executable: z.literal(false),
  constraints: z.array(z.string()),
  sources: z.array(SourceSchema),
  chains: z.array(
    z.object({
      name: z.string().min(1),
      defi_tvl_usd: NUMBER_OR_NULL,
      source: z.string(),
      observed_at: z.iso.datetime(),
    }),
  ),
  protocols: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      category: z.string(),
      chains: z.array(z.string()),
      url: z.string(),
      logo: z.string(),
      tvl_by_chain_usd: z.record(z.string(), z.number().finite()),
      tvl_all_chains_usd: NUMBER_OR_NULL,
      change_pct: z.object({ '1d': NUMBER_OR_NULL, '7d': NUMBER_OR_NULL }),
      source: z.string(),
      observed_at: z.iso.datetime(),
      executable: z.literal(false),
    }),
  ),
  yield_pools: z.array(
    z.object({
      pool_id: z.string(),
      chain: z.string().min(1),
      project: z.string(),
      symbol: z.string(),
      pool_meta: z.string().nullable(),
      stablecoin: z.boolean(),
      tvl_usd: NUMBER_OR_NULL,
      total_apy_pct: NUMBER_OR_NULL,
      apy_mean_30d_pct: NUMBER_OR_NULL,
      base_apy_pct: NUMBER_OR_NULL,
      reward_apy_pct: NUMBER_OR_NULL,
      underlying_tokens: z.array(z.string()),
      source: z.string(),
      observed_at: z.iso.datetime(),
      executable: z.literal(false),
      asset_identity_verified: z.literal(false),
    }),
  ),
});
const HistorySchema = z.object({
  schema_version: z.literal('harbor.research.history.v1'),
  captured_at: z.iso.datetime(),
  source: z.string(),
  series: z.array(
    z.object({
      chain: z.string().min(1),
      points: z.array(z.object({ timestamp_unix: z.number().int(), tvl_usd: z.number().finite() })),
    }),
  ),
});

export interface ResearchSource {
  id: string;
  name: string;
  url: string;
  attribution: string;
  capturedAt: string;
}

export interface ChainRow {
  name: string;
  defiTvlUsd: number | null;
  source: string;
  observedAt: string;
}

export interface ProtocolRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  url: string;
  logo: string;
  tvlByChainUsd: Record<string, number>;
  allChainsTvlUsd: number | null;
  change: { day: number | null; week: number | null };
  source: string;
  observedAt: string;
}

export interface YieldPoolRow {
  id: string;
  chain: string;
  project: string;
  symbol: string;
  meta: string | null;
  stablecoin: boolean;
  tvlUsd: number | null;
  totalApyPct: number | null;
  mean30dApyPct: number | null;
  baseApyPct: number | null;
  rewardApyPct: number | null;
  underlyingTokens: string[];
  source: string;
  observedAt: string;
}

/** A dated, read-only research projection. Nothing in it is a live rate or an executable quote. */
export interface ResearchSnapshot {
  live: false;
  executable: false;
  sources: ResearchSource[];
  chains: ChainRow[];
  protocols: ProtocolRow[];
  yieldPools: YieldPoolRow[];
  caveats: string[];
}

export interface ResearchHistory {
  capturedAt: string;
  source: string;
  series: { id: string; label: string; points: { timestamp: number; valueUsd: number }[] }[];
}

/** Parses a committed snapshot. Every row must name a source the snapshot declares. */
export function parseResearchSnapshot(input: unknown): ResearchSnapshot {
  const data = SnapshotSchema.parse(input);
  const sourceIds = new Set(data.sources.map((source) => source.id));
  for (const row of [...data.chains, ...data.protocols, ...data.yield_pools]) {
    if (!sourceIds.has(row.source)) throw new Error(`Research row cites an undeclared source: ${row.source}`);
  }
  return {
    live: false,
    executable: false,
    sources: data.sources.map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      attribution: source.attribution,
      capturedAt: source.captured_at,
    })),
    chains: data.chains.map((row) => ({
      name: row.name,
      defiTvlUsd: row.defi_tvl_usd,
      source: row.source,
      observedAt: row.observed_at,
    })),
    protocols: data.protocols.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      url: row.url,
      logo: row.logo,
      tvlByChainUsd: row.tvl_by_chain_usd,
      allChainsTvlUsd: row.tvl_all_chains_usd,
      change: { day: row.change_pct['1d'], week: row.change_pct['7d'] },
      source: row.source,
      observedAt: row.observed_at,
    })),
    yieldPools: data.yield_pools.map((row) => ({
      id: row.pool_id,
      chain: row.chain,
      project: row.project,
      symbol: row.symbol,
      meta: row.pool_meta,
      stablecoin: row.stablecoin,
      tvlUsd: row.tvl_usd,
      totalApyPct: row.total_apy_pct,
      mean30dApyPct: row.apy_mean_30d_pct,
      baseApyPct: row.base_apy_pct,
      rewardApyPct: row.reward_apy_pct,
      underlyingTokens: row.underlying_tokens,
      source: row.source,
      observedAt: row.observed_at,
    })),
    caveats: data.constraints,
  };
}

export function parseResearchHistory(input: unknown): ResearchHistory {
  const data = HistorySchema.parse(input);
  return {
    capturedAt: data.captured_at,
    source: data.source,
    series: data.series.map((series) => ({
      id: series.chain.toLowerCase(),
      label: `${series.chain} DeFi TVL`,
      points: series.points.map((point) => ({ timestamp: point.timestamp_unix * 1000, valueUsd: point.tvl_usd })),
    })),
  };
}

export function safeResearchUrl(value: string): string | null {
  const parsed = HTTP_URL.safeParse(value);
  return parsed.success ? parsed.data : null;
}
