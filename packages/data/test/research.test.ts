import { describe, expect, it } from 'vitest';
import history from '../../../research/data/research-history.json' with { type: 'json' };
import committed from '../../../research/data/research-snapshot.json' with { type: 'json' };
import { parseResearchHistory, parseResearchSnapshot, safeResearchUrl } from '../src/research.ts';

const OBSERVED = '2026-11-04T00:00:00Z';
const source = {
  id: 'defillama',
  name: 'DefiLlama',
  url: 'https://defillama.com',
  attribution: 'DefiLlama',
  captured_at: OBSERVED,
  live: false,
};
const snapshot = {
  schema_version: 'harbor.research.v1',
  live: false,
  executable: false,
  constraints: ['Dated snapshot.'],
  sources: [source],
  chains: [{ name: 'Near', defi_tvl_usd: 1_000_000, source: 'defillama', observed_at: OBSERVED }],
  protocols: [
    {
      id: '1',
      slug: 'venue-a',
      name: 'Venue A',
      category: 'Lending',
      chains: ['Near', 'Ethereum'],
      url: 'https://venue-a.example',
      logo: 'https://icons.example/venue-a.png',
      tvl_by_chain_usd: { Near: 0, Ethereum: 500 },
      tvl_all_chains_usd: null,
      change_pct: { '1d': null, '7d': 1.5 },
      source: 'defillama',
      observed_at: OBSERVED,
      executable: false,
    },
  ],
  yield_pools: [
    {
      pool_id: 'pool-1',
      chain: 'Near',
      project: 'venue-a',
      symbol: 'USDC',
      pool_meta: null,
      stablecoin: true,
      tvl_usd: 250_000,
      total_apy_pct: 6.1,
      apy_mean_30d_pct: null,
      base_apy_pct: 5,
      reward_apy_pct: 1.1,
      underlying_tokens: [],
      source: 'defillama',
      observed_at: OBSERVED,
      executable: false,
      asset_identity_verified: false,
    },
  ],
};

describe('parseResearchSnapshot', () => {
  it('loads a snapshot with its provenance', () => {
    const research = parseResearchSnapshot(snapshot);
    expect(research.sources[0]).toMatchObject({ id: 'defillama', capturedAt: OBSERVED });
    expect(research.yieldPools[0]).toMatchObject({ chain: 'Near', totalApyPct: 6.1, stablecoin: true });
    expect(research.live).toBe(false);
    expect(research.executable).toBe(false);
  });

  it('keeps a missing value null and a reported zero zero', () => {
    const [protocol] = parseResearchSnapshot(snapshot).protocols;
    expect(protocol?.allChainsTvlUsd).toBeNull();
    expect(protocol?.tvlByChainUsd.Near).toBe(0);
    expect(protocol?.change.day).toBeNull();
  });

  it('refuses a snapshot that claims to be live or executable, or cites an unknown source', () => {
    expect(() => parseResearchSnapshot({ ...snapshot, live: true })).toThrow();
    expect(() => parseResearchSnapshot({ ...snapshot, executable: true })).toThrow();
    expect(() => parseResearchSnapshot({ ...snapshot, schema_version: 'harbor.research.v2' })).toThrow();
    expect(() => parseResearchSnapshot({ ...snapshot, sources: [] })).toThrow(/undeclared source/);
  });

  it('parses the committed snapshot', () => {
    expect(parseResearchSnapshot(committed).live).toBe(false);
  });
});

describe('parseResearchHistory', () => {
  it('turns chain TVL points into millisecond series', () => {
    const parsed = parseResearchHistory({
      schema_version: 'harbor.research.history.v1',
      captured_at: OBSERVED,
      source: 'defillama',
      series: [{ chain: 'Near', points: [{ timestamp_unix: 1_700_000_000, tvl_usd: 10 }] }],
    });
    expect(parsed.series[0]).toEqual({
      id: 'near',
      label: 'Near DeFi TVL',
      points: [{ timestamp: 1_700_000_000_000, valueUsd: 10 }],
    });
  });

  it('parses the committed history', () => {
    expect(parseResearchHistory(history).series).toBeInstanceOf(Array);
  });
});

describe('safeResearchUrl', () => {
  it('allows only http and https links', () => {
    expect(safeResearchUrl('https://defillama.com')).toBe('https://defillama.com');
    expect(safeResearchUrl('javascript:alert(1)')).toBeNull();
  });
});
