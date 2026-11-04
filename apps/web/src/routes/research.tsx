import type { ProtocolRow, YieldPoolRow } from '@harbor/data/research';
import { Input } from '@harbor/ui/components/input';
import { Tabs, TabsContent } from '@harbor/ui/components/tabs';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';

import { LineTab, LineTabsList, Panel } from '../components/brand.tsx';
import { ProtocolLogo } from '../components/protocol-logo.tsx';
import { ResearchDataTable } from '../components/research-data-table.tsx';
import { EmptyState, PageHeader } from '../components/workspace.tsx';
import { formatApy, formatPercentPoints, formatUsd, formatUtc } from '../lib/format.ts';
import { capturedAt, research } from '../lib/research.ts';

const ALL = 'all';
const HOME_CHAIN = 'NEAR';

export function ResearchPage() {
  const [chain, setChain] = useState(ALL);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Research"
        kicker="Cross-chain venues"
        description="Yield pools and protocols on the chains Harbor can reach, from a dated snapshot. Nothing here is a live rate or an executable quote."
        meta={<SnapshotNotice />}
      />
      {research.yieldPools.length === 0 ? (
        <Panel label="Snapshot">
          <EmptySnapshot />
        </Panel>
      ) : (
        <>
          <ChainGrid selected={chain} onSelect={setChain} />
          <Tabs defaultValue="yields" className="gap-5">
            <LineTabsList label="Research views">
              <LineTab value="yields">Yield pools</LineTab>
              <LineTab value="protocols">Protocols</LineTab>
            </LineTabsList>
            <TabsContent value="yields">
              <YieldTable chain={chain} />
            </TabsContent>
            <TabsContent value="protocols">
              <ProtocolTable chain={chain} />
            </TabsContent>
          </Tabs>
          <ul className="space-y-1.5 border-t border-line pt-5 text-xs text-muted-foreground">
            {research.caveats.map((caveat) => (
              <li key={caveat} className="flex gap-2">
                <span aria-hidden="true" className="text-primary">
                  ■
                </span>
                {caveat}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** When the snapshot was taken and where it came from. */
export function SnapshotNotice() {
  const captured = capturedAt();
  const source = research.sources[0];
  if (!captured) return <span>No snapshot captured yet</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="border border-line px-1.5 py-0.5 text-[11px] font-medium tracking-[0.6px] text-foreground uppercase">
        Snapshot
      </span>
      <span>Captured {formatUtc(captured)}</span>
      {source ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline decoration-line underline-offset-4 hover:text-primary"
        >
          Data from DefiLlama <ArrowUpRight className="size-3" aria-hidden="true" />
        </a>
      ) : null}
    </span>
  );
}

/** Each chain with its DeFi TVL. Choosing one filters the pools and protocols below. */
function ChainGrid({ selected, onSelect }: { selected: string; onSelect: (chain: string) => void }) {
  const pools = new Map<string, number>();
  for (const pool of research.yieldPools) pools.set(pool.chain, (pools.get(pool.chain) ?? 0) + 1);
  const chains = [...research.chains]
    .filter((chain) => pools.has(chain.name))
    .sort((a, b) =>
      a.name === HOME_CHAIN ? -1 : b.name === HOME_CHAIN ? 1 : (b.defiTvlUsd ?? 0) - (a.defiTvlUsd ?? 0),
    );
  const totalTvl = chains.reduce((sum, chain) => sum + (chain.defiTvlUsd ?? 0), 0);
  const cells = [
    { id: ALL, name: 'All chains', tvl: totalTvl, count: research.yieldPools.length },
    ...chains.map((chain) => ({
      id: chain.name,
      name: chain.name,
      tvl: chain.defiTvlUsd,
      count: pools.get(chain.name) ?? 0,
    })),
  ];
  return (
    <Panel label="Chains" aside="DeFi TVL" bodyClassName="p-0" className="overflow-hidden" labelId="research-chains">
      <fieldset
        className="flex snap-x overflow-x-auto sm:grid sm:grid-cols-3 sm:overflow-visible md:grid-cols-4 xl:grid-cols-6"
        aria-label="Filter by chain"
      >
        {cells.map((cell) => (
          <button
            key={cell.id}
            type="button"
            aria-pressed={selected === cell.id}
            onClick={() => onSelect(cell.id)}
            className="research-chain -mr-px -mb-px flex min-h-24 w-[44%] shrink-0 snap-start sm:w-auto flex-col items-start justify-between gap-3 border-r border-b border-line p-4 text-left transition-colors hover:bg-secondary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            <span className="text-[11px] font-medium tracking-[0.6px] uppercase">{cell.name}</span>
            <span className="font-serif text-[26px] leading-none font-bold tracking-[-1px]">{formatUsd(cell.tvl)}</span>
            <span className="text-[11px] opacity-70">
              {cell.count} {cell.count === 1 ? 'pool' : 'pools'}
            </span>
          </button>
        ))}
      </fieldset>
    </Panel>
  );
}

function askAbout(pool: YieldPoolRow): string {
  return `Compare ${pool.symbol} on ${pool.project} (${pool.chain}) with similar pools. What are the risks, and how would I exit?`;
}

function YieldTable({ chain }: { chain: string }) {
  const [query, setQuery] = useState('');
  const [stableOnly, setStableOnly] = useState(false);
  const rows = research.yieldPools
    .filter((pool) => chain === ALL || pool.chain === chain)
    .filter((pool) => !stableOnly || pool.stablecoin)
    .filter((pool) => `${pool.project} ${pool.symbol}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => (b.totalApyPct ?? -1) - (a.totalApyPct ?? -1));
  return (
    <ResearchDataTable<YieldPoolRow>
      tableKey="research-yields"
      label="Yield pools"
      rows={rows}
      getRowId={(row) => row.id}
      controls={
        <>
          <Input
            type="search"
            aria-label="Search pools"
            placeholder="Search project or asset"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            className="h-11 w-full sm:w-64"
          />
          <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={stableOnly}
              onChange={(event) => setStableOnly(event.currentTarget.checked)}
            />
            Stablecoins only
          </label>
        </>
      }
      columns={[
        {
          id: 'pool',
          label: 'Pool',
          required: true,
          cell: (row) => (
            <div>
              <p className="font-medium">
                {row.symbol}
                {row.stablecoin ? (
                  <span className="ml-2 border border-line px-1 py-px text-[10px] font-medium tracking-[0.4px] text-muted-foreground uppercase">
                    Stable
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {row.project}
                {row.meta ? ` · ${row.meta}` : ''}
              </p>
            </div>
          ),
        },
        { id: 'chain', label: 'Chain', cell: (row) => row.chain },
        {
          id: 'apy',
          label: 'Total APY',
          numeric: true,
          emphasis: true,
          cell: (row) => formatApy(row.totalApyPct),
        },
        { id: 'mean', label: '30d mean', numeric: true, cell: (row) => formatApy(row.mean30dApyPct) },
        { id: 'base', label: 'Base', numeric: true, cell: (row) => formatApy(row.baseApyPct) },
        { id: 'reward', label: 'Rewards', numeric: true, cell: (row) => formatApy(row.rewardApyPct) },
        { id: 'tvl', label: 'TVL', numeric: true, cell: (row) => (row.tvlUsd === null ? '—' : formatUsd(row.tvlUsd)) },
        {
          id: 'ask',
          label: 'Ask',
          numeric: true,
          cell: (row) => (
            <Link
              to="/chat"
              search={{ ask: askAbout(row) }}
              aria-label={`Ask Harbor about ${row.symbol} on ${row.project}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Ask <ArrowUpRight className="size-3" aria-hidden="true" />
            </Link>
          ),
        },
      ]}
    />
  );
}

function ProtocolTable({ chain }: { chain: string }) {
  const [query, setQuery] = useState('');
  const tvl = (protocol: ProtocolRow) =>
    chain === ALL ? protocol.allChainsTvlUsd : (protocol.tvlByChainUsd[chain] ?? null);
  const rows = research.protocols
    .filter((protocol) => chain === ALL || protocol.chains.includes(chain))
    .filter((protocol) => `${protocol.name} ${protocol.category}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => (tvl(b) ?? -1) - (tvl(a) ?? -1));
  return (
    <ResearchDataTable<ProtocolRow>
      tableKey="research-protocols"
      label="Protocols"
      rows={rows}
      getRowId={(row) => row.id}
      controls={
        <Input
          type="search"
          aria-label="Search protocols"
          placeholder="Search name or category"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          className="h-11 w-full sm:w-64"
        />
      }
      columns={[
        {
          id: 'protocol',
          label: 'Protocol',
          required: true,
          cell: (row) => (
            <div className="flex items-center gap-3">
              <ProtocolLogo name={row.name} fallback={row.logo} className="size-7" />
              <div>
                <p className="font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">{row.category}</p>
              </div>
            </div>
          ),
        },
        {
          id: 'chains',
          label: 'Chains',
          cell: (row) =>
            row.chains.length > 3
              ? `${row.chains.slice(0, 3).join(', ')} +${row.chains.length - 3}`
              : row.chains.join(', '),
        },
        {
          id: 'tvl',
          label: chain === ALL ? 'TVL' : `TVL on ${chain}`,
          numeric: true,
          emphasis: true,
          cell: (row) => formatUsd(tvl(row)),
        },
        { id: 'day', label: '1d', numeric: true, cell: (row) => <Change value={row.change.day} /> },
        { id: 'week', label: '7d', numeric: true, cell: (row) => <Change value={row.change.week} /> },
      ]}
    />
  );
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return <span className={value < 0 ? 'text-destructive' : 'text-success'}>{formatPercentPoints(value)}</span>;
}

function EmptySnapshot() {
  return (
    <EmptyState
      title="No research snapshot yet"
      description="Run pnpm research:collect to capture a dated snapshot from DefiLlama, then reload."
    />
  );
}
