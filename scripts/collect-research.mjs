// Captures a dated research snapshot from DefiLlama's public APIs into research/data/.
// Usage: node scripts/collect-research.mjs
//
// Only chains Harbor can reach through 1Click are kept, and each table is capped so the snapshot
// stays small enough to bundle into the app and the Worker. Nothing captured here is a live rate or
// an executable quote; the parser in packages/data enforces that on load.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const capturedAt = new Date().toISOString();

/** DefiLlama's chain name, mapped to the name Harbor shows. */
const CHAINS = new Map([
  ['Near', 'NEAR'],
  ['Ethereum', 'Ethereum'],
  ['Arbitrum', 'Arbitrum'],
  ['Base', 'Base'],
  ['Solana', 'Solana'],
  ['Bitcoin', 'Bitcoin'],
  ['BSC', 'BNB Chain'],
  ['Binance', 'BNB Chain'],
  ['Optimism', 'Optimism'],
  ['OP Mainnet', 'Optimism'],
  ['Polygon', 'Polygon'],
  ['Avalanche', 'Avalanche'],
  ['Gnosis', 'Gnosis'],
  ['Berachain', 'Berachain'],
  ['TON', 'TON'],
  ['Tron', 'Tron'],
  ['Sui', 'Sui'],
  ['Aptos', 'Aptos'],
]);
const HISTORY_CHAINS = ['Near', 'Ethereum', 'Solana', 'Base', 'Arbitrum'];
const POOLS_PER_CHAIN = 30;
const NEAR_POOLS = 60;
const PROTOCOLS_PER_CHAIN = 15;
const HISTORY_DAYS = 365;
const SKIPPED_CATEGORIES = new Set(['CEX', 'Chain', 'Bridge', 'Canonical Bridge']);

const SOURCES = [
  {
    id: 'defillama-yields',
    name: 'DefiLlama Yields',
    url: 'https://defillama.com/yields',
    attribution: 'Yield data from DefiLlama (defillama.com)',
  },
  {
    id: 'defillama-protocols',
    name: 'DefiLlama Protocols',
    url: 'https://defillama.com/',
    attribution: 'Protocol TVL from DefiLlama (defillama.com)',
  },
  {
    id: 'defillama-chains',
    name: 'DefiLlama Chains',
    url: 'https://defillama.com/chains',
    attribution: 'Chain TVL from DefiLlama (defillama.com)',
  },
].map((source) => ({ ...source, captured_at: capturedAt, live: false }));

async function get(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const round = (value, places) => (value === null ? null : Number(value.toFixed(places)));

const [poolsBody, protocolsBody, chainsBody] = await Promise.all([
  get('https://yields.llama.fi/pools'),
  get('https://api.llama.fi/protocols'),
  get('https://api.llama.fi/v2/chains'),
]);

const chains = chainsBody
  .filter((chain) => CHAINS.has(chain.name) && finite(chain.tvl) !== null)
  .map((chain) => ({
    name: CHAINS.get(chain.name),
    defi_tvl_usd: Math.round(chain.tvl),
    source: 'defillama-chains',
    observed_at: capturedAt,
  }))
  .filter((chain, index, all) => all.findIndex((other) => other.name === chain.name) === index)
  .sort((a, b) => b.defi_tvl_usd - a.defi_tvl_usd);

const poolsByChain = new Map();
for (const pool of poolsBody.data) {
  const chain = CHAINS.get(pool.chain);
  const apy = finite(pool.apy);
  const tvl = finite(pool.tvlUsd);
  if (!chain || apy === null || tvl === null || pool.outlier || apy <= 0 || apy > 200) continue;
  // NEAR is Harbor's home chain and its pools are small, so it keeps a lower floor than the rest.
  if (tvl < (chain === 'NEAR' ? 10_000 : 1_000_000)) continue;
  const list = poolsByChain.get(chain) ?? [];
  list.push({
    pool_id: pool.pool,
    chain,
    project: pool.project,
    symbol: pool.symbol,
    pool_meta: pool.poolMeta ?? null,
    stablecoin: Boolean(pool.stablecoin),
    tvl_usd: Math.round(tvl),
    total_apy_pct: round(apy, 3),
    apy_mean_30d_pct: round(finite(pool.apyMean30d), 3),
    base_apy_pct: round(finite(pool.apyBase), 3),
    reward_apy_pct: round(finite(pool.apyReward), 3),
    underlying_tokens: Array.isArray(pool.underlyingTokens) ? pool.underlyingTokens.slice(0, 4) : [],
    source: 'defillama-yields',
    observed_at: capturedAt,
    executable: false,
    asset_identity_verified: false,
  });
  poolsByChain.set(chain, list);
}
const yieldPools = [...poolsByChain.entries()].flatMap(([chain, list]) =>
  list.sort((a, b) => b.tvl_usd - a.tvl_usd).slice(0, chain === 'NEAR' ? NEAR_POOLS : POOLS_PER_CHAIN),
);

const protocolIds = new Set();
const protocols = [];
for (const [llamaChain] of CHAINS) {
  const ranked = protocolsBody
    .filter((protocol) => !SKIPPED_CATEGORIES.has(protocol.category) && finite(protocol.chainTvls?.[llamaChain]) > 0)
    .sort((a, b) => b.chainTvls[llamaChain] - a.chainTvls[llamaChain])
    .slice(0, PROTOCOLS_PER_CHAIN);
  for (const protocol of ranked) {
    if (protocolIds.has(protocol.id)) continue;
    protocolIds.add(protocol.id);
    const tvlByChain = {};
    for (const [name, value] of Object.entries(protocol.chainTvls ?? {})) {
      const shown = CHAINS.get(name);
      if (shown && finite(value) !== null) tvlByChain[shown] = Math.round(value);
    }
    protocols.push({
      id: String(protocol.id),
      slug: protocol.slug,
      name: protocol.name,
      category: protocol.category ?? 'Other',
      chains: [...new Set((protocol.chains ?? []).map((name) => CHAINS.get(name)).filter(Boolean))],
      url: typeof protocol.url === 'string' ? protocol.url : '',
      logo: typeof protocol.logo === 'string' ? protocol.logo : '',
      tvl_by_chain_usd: tvlByChain,
      tvl_all_chains_usd: finite(protocol.tvl) === null ? null : Math.round(protocol.tvl),
      change_pct: { '1d': round(finite(protocol.change_1d), 2), '7d': round(finite(protocol.change_7d), 2) },
      source: 'defillama-protocols',
      observed_at: capturedAt,
      executable: false,
    });
  }
}
protocols.sort((a, b) => (b.tvl_all_chains_usd ?? 0) - (a.tvl_all_chains_usd ?? 0));

const cutoff = Date.now() / 1000 - HISTORY_DAYS * 86_400;
const series = [];
for (const llamaChain of HISTORY_CHAINS) {
  const points = await get(`https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(llamaChain)}`);
  series.push({
    chain: CHAINS.get(llamaChain),
    // One point a week, plus the newest, is plenty for a year-long line.
    points: points
      .filter((point) => point.date >= cutoff && finite(point.tvl) !== null)
      .filter((_, index, recent) => index % 7 === (recent.length - 1) % 7)
      .map((point) => ({ timestamp_unix: point.date, tvl_usd: Math.round(point.tvl) })),
  });
}

const snapshot = {
  schema_version: 'harbor.research.v1',
  live: false,
  executable: false,
  constraints: [
    'A dated research snapshot, not live rates and not executable quotes.',
    'Pool and protocol names come from the source; asset identities are not verified.',
  ],
  sources: SOURCES,
  chains,
  protocols,
  yield_pools: yieldPools,
};
const history = {
  schema_version: 'harbor.research.history.v1',
  captured_at: capturedAt,
  source: 'defillama-chains',
  series,
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
await writeFile(path.join(root, 'research/data/research-snapshot.json'), json(snapshot));
await writeFile(path.join(root, 'research/data/research-history.json'), json(history));
console.log(
  `Captured ${chains.length} chains, ${protocols.length} protocols, ${yieldPools.length} pools and ${series.length} TVL series at ${capturedAt}.`,
);
