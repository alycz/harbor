import type { ProtocolRow, YieldPoolRow } from '@harbor/data/research';
import { Input } from '@harbor/ui/components/input';
import { Tabs, TabsContent } from '@harbor/ui/components/tabs';
import { Link } from '@tanstack/react-router';
import { ArrowDownRight, ArrowUpRight, Database, Search, Telescope } from 'lucide-react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useState } from 'react';

import { ChainLogo, chainLogoUrl, LogoPair, ProtocolLogo } from '../components/protocol-logo.tsx';
import { ResearchDataTable } from '../components/research-data-table.tsx';
import { Chip, EmptyState, HeroCard, Panel, SectionTitle, Segment, SegmentedList } from '../components/workspace.tsx';
import { formatApy, formatPercentPoints, formatUsd, formatUtc } from '../lib/format.ts';
import { capturedAt, research } from '../lib/research.ts';
import { apyDrift, chainsWithPools, projectLogo, projectName } from '../lib/research-view.ts';

const ALL = 'all';

export function ResearchPage() {
  const [chain, setChain] = useState(ALL);
  const [view, setView] = useState('yields');
  const chains = chainsWithPools();
  const totalTvl = chains.reduce((sum, entry) => sum + (entry.tvl ?? 0), 0);
  const empty = research.yieldPools.length === 0;
  return (
    <div className="ws-stagger flex flex-col gap-8">
      <HeroCard
        eyebrow="Cross-chain research"
        icon={<Telescope />}
        title="Yields and protocols across every chain Harbor can reach."
        description="From a dated snapshot, so you can compare before you ask. Nothing here is a live rate or an executable quote."
        stats={
          empty
            ? [{ label: 'Snapshot', value: 'None yet' }]
            : [
                { label: 'DeFi TVL', value: formatUsd(totalTvl) },
                { label: 'Chains', value: chains.length },
                { label: 'Yield pools', value: research.yieldPools.length },
              ]
        }
        footer={<SnapshotNotice onBand />}
      />
      {empty ? (
        <Panel>
          <EmptySnapshot />
        </Panel>
      ) : (
        <>
          <section aria-labelledby="research-chains" className="flex flex-col gap-3.5">
            <SectionTitle
              id="research-chains"
              title="Chains"
              meta={chain === ALL ? `${chains.length} chains · all pools` : `Showing ${chain}`}
            />
            <ChainFilter chains={chains} selected={chain} onSelect={setChain} totalTvl={totalTvl} />
          </section>
          <Tabs value={view} onValueChange={(next) => setView(String(next))} className="gap-3.5">
            <SectionTitle
              id="research-table"
              title={view === 'yields' ? 'Yield pools' : 'Protocols'}
              meta={view === 'yields' ? 'Highest APY first' : 'Largest TVL first'}
              actions={
                <SegmentedList label="Research views">
                  <Segment value="yields">Yield pools</Segment>
                  <Segment value="protocols">Protocols</Segment>
                </SegmentedList>
              }
            />
            <TabsContent value="yields">
              <YieldTable chain={chain} />
            </TabsContent>
            <TabsContent value="protocols">
              <ProtocolTable chain={chain} />
            </TabsContent>
          </Tabs>
          <ul className="grid gap-2 border-t border-border pt-5 text-[12.5px] leading-relaxed text-muted-foreground sm:grid-cols-2">
            {research.caveats.map((caveat) => (
              <li key={caveat} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-border-strong" />
                {caveat}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** When the snapshot was taken and where it came from. `onBand` sets it on the ink hero. */
export function SnapshotNotice({ onBand = false }: { onBand?: boolean }) {
  const captured = capturedAt();
  const source = research.sources[0];
  if (!captured) return <span>No snapshot captured yet</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
      <span className="inline-flex items-center gap-1.5">
        <Database
          className={`size-3.5 ${onBand ? 'text-[var(--harbor-sky)]' : 'text-muted-foreground'}`}
          aria-hidden="true"
        />
        Snapshot captured {formatUtc(captured)}
      </span>
      {source ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex items-center gap-1 underline decoration-dashed underline-offset-[3px] transition-colors ${onBand ? 'decoration-white/30 hover:text-band-foreground hover:decoration-white/70' : 'decoration-border-strong hover:text-foreground'}`}
        >
          Data from DefiLlama <ArrowUpRight className="size-3" aria-hidden="true" />
        </a>
      ) : null}
    </span>
  );
}

/** Each chain as a chip with its DeFi TVL. The chosen one is a raised pill that travels to your choice. */
function ChainFilter({
  chains,
  selected,
  onSelect,
  totalTvl,
}: {
  chains: ReturnType<typeof chainsWithPools>;
  selected: string;
  onSelect: (chain: string) => void;
  totalTvl: number;
}) {
  const reduced = useReducedMotion();
  const cells = [{ name: ALL, tvl: totalTvl, pools: research.yieldPools.length }, ...chains];
  return (
    <LayoutGroup id="chain-filter">
      <fieldset
        aria-label="Filter by chain"
        className="-mx-4 flex snap-x scroll-px-4 gap-1.5 overflow-x-auto px-4 py-0.5 [mask-image:linear-gradient(90deg,#000_calc(100%-56px),transparent)] [scrollbar-width:none] sm:-mx-1 sm:scroll-px-1 sm:px-1"
      >
        {cells.map((cell) => {
          const active = selected === cell.name;
          return (
            <button
              key={cell.name}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(cell.name)}
              className={`group relative flex h-10 shrink-0 snap-start items-center gap-2 rounded-lg border px-2.5 text-[13.5px] transition-colors duration-150 ${active ? 'border-transparent text-foreground' : 'border-border bg-card/50 text-muted-foreground hover:border-border-strong hover:bg-card hover:text-foreground'}`}
            >
              {active ? (
                <motion.span
                  layoutId="chain-active"
                  aria-hidden="true"
                  className="absolute inset-0 rounded-lg bg-card shadow-[0_1px_2px_rgb(23_25_31/0.08)] ring-1 ring-border-strong"
                  transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 480, damping: 40 }}
                />
              ) : null}
              <span className="relative flex items-center gap-2">
                {cell.name === ALL ? (
                  <span
                    aria-hidden="true"
                    className="grid size-5 place-items-center rounded-full bg-secondary text-muted-foreground"
                  >
                    <Telescope className="size-3" />
                  </span>
                ) : (
                  <ChainLogo chain={cell.name} className="size-5" />
                )}
                <span className="font-medium">{cell.name === ALL ? 'All chains' : cell.name}</span>
                <span className="ws-num text-[12.5px] text-muted-foreground">{formatUsd(cell.tvl)}</span>
              </span>
            </button>
          );
        })}
      </fieldset>
    </LayoutGroup>
  );
}

function askAbout(pool: YieldPoolRow): string {
  return `Compare ${pool.symbol} on ${projectName(pool.project)} (${pool.chain}) with similar pools. What are the risks, and how would I exit?`;
}

/** A search field with its icon inside, for the table toolbars. */
function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-9 pl-8 text-[13.5px]"
      />
    </div>
  );
}

function YieldTable({ chain }: { chain: string }) {
  const [query, setQuery] = useState('');
  const [stableOnly, setStableOnly] = useState(false);
  const rows = research.yieldPools
    .filter((pool) => chain === ALL || pool.chain === chain)
    .filter((pool) => !stableOnly || pool.stablecoin)
    .filter((pool) =>
      `${pool.project} ${projectName(pool.project)} ${pool.symbol}`.toLowerCase().includes(query.toLowerCase().trim()),
    )
    .sort((a, b) => (b.totalApyPct ?? -1) - (a.totalApyPct ?? -1));
  return (
    <ResearchDataTable<YieldPoolRow>
      tableKey="research-yields"
      label="Yield pools"
      rows={rows}
      getRowId={(row) => row.id}
      controls={
        <>
          <SearchField label="Search project or asset" value={query} onChange={setQuery} />
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
            <input
              type="checkbox"
              className="size-3.5"
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
            <div className="flex items-center gap-3">
              <LogoPair
                className="size-8"
                primary={{ name: projectName(row.project), url: projectLogo(row.project) }}
                secondary={{ name: row.chain, url: chainLogoUrl(row.chain) }}
              />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 font-medium">
                  {row.symbol}
                  {row.stablecoin ? (
                    <Chip tone="neutral" className="h-[18px] px-1 text-[11px]">
                      Stable
                    </Chip>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {projectName(row.project)}
                  {row.meta ? ` · ${row.meta}` : ''}
                </p>
              </div>
            </div>
          ),
        },
        {
          id: 'chain',
          label: 'Chain',
          cell: (row) => (
            <span className="inline-flex items-center gap-2">
              <ChainLogo chain={row.chain} className="size-4" />
              {row.chain}
            </span>
          ),
        },
        {
          id: 'apy',
          label: 'Total APY',
          numeric: true,
          emphasis: true,
          cell: (row) => formatApy(row.totalApyPct),
        },
        { id: 'mean', label: 'vs 30d mean', numeric: true, cell: (row) => <Drift row={row} /> },
        { id: 'base', label: 'Base', numeric: true, cell: (row) => <Muted>{formatApy(row.baseApyPct)}</Muted> },
        { id: 'reward', label: 'Rewards', numeric: true, cell: (row) => <Muted>{formatApy(row.rewardApyPct)}</Muted> },
        { id: 'tvl', label: 'TVL', numeric: true, cell: (row) => (row.tvlUsd === null ? '—' : formatUsd(row.tvlUsd)) },
        {
          id: 'ask',
          label: '',
          numeric: true,
          cell: (row) => (
            <AskLink to={askAbout(row)} label={`Ask Harbor about ${row.symbol} on ${projectName(row.project)}`} />
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
  const largest = Math.max(1, ...rows.map((row) => tvl(row) ?? 0));
  return (
    <ResearchDataTable<ProtocolRow>
      tableKey="research-protocols"
      label="Protocols"
      rows={rows}
      getRowId={(row) => row.id}
      controls={<SearchField label="Search name or category" value={query} onChange={setQuery} />}
      columns={[
        {
          id: 'protocol',
          label: 'Protocol',
          required: true,
          cell: (row) => (
            <div className="flex items-center gap-3">
              <ProtocolLogo name={row.name} fallback={row.logo} className="size-8" />
              <div>
                <p className="font-medium">{row.name}</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{row.category}</p>
              </div>
            </div>
          ),
        },
        { id: 'chains', label: 'Chains', cell: (row) => <ChainStack chains={row.chains} /> },
        {
          id: 'tvl',
          label: chain === ALL ? 'TVL' : `TVL on ${chain}`,
          numeric: true,
          emphasis: true,
          cell: (row) => <ShareBar value={tvl(row)} max={largest} />,
        },
        { id: 'day', label: '1d', numeric: true, cell: (row) => <Change value={row.change.day} /> },
        { id: 'week', label: '7d', numeric: true, cell: (row) => <Change value={row.change.week} /> },
      ]}
    />
  );
}

/** A protocol's chains as overlapping marks, then a count of the rest. */
function ChainStack({ chains }: { chains: string[] }) {
  const shown = chains.slice(0, 4);
  return (
    <span className="inline-flex items-center gap-2" title={chains.join(', ')}>
      <span className="flex -space-x-1.5">
        {shown.map((name) => (
          <span key={name} className="rounded-full bg-card p-px">
            <ChainLogo chain={name} className="size-5" />
          </span>
        ))}
      </span>
      <span className="text-[12.5px] text-muted-foreground">
        {chains.length > shown.length ? `+${chains.length - shown.length}` : chains.length === 1 ? chains[0] : null}
      </span>
    </span>
  );
}

/** A value with a short bar of its share of the largest, as Royco's coverage column. */
function ShareBar({ value, max }: { value: number | null; max: number }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-3">
      <span aria-hidden="true" className="hidden h-1 w-14 overflow-hidden rounded-full bg-secondary sm:block">
        <span
          className="block h-full rounded-full bg-foreground/70"
          style={{ width: `${Math.max(4, (value / max) * 100)}%` }}
        />
      </span>
      <span className="min-w-[4.5rem]">{formatUsd(value)}</span>
    </span>
  );
}

/** How far the current APY sits from its 30-day mean: up in green, down in red, a dash when unknown. */
function Drift({ row }: { row: YieldPoolRow }) {
  const drift = apyDrift(row);
  if (drift === null) return <Muted>—</Muted>;
  const flat = Math.abs(drift) < 0.05;
  const Icon = drift > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${flat ? 'text-muted-foreground' : drift > 0 ? 'text-success' : 'text-destructive'}`}
      title={`30-day mean ${formatApy(row.mean30dApyPct)}`}
    >
      {flat ? null : <Icon className="size-3.5" aria-hidden="true" />}
      {formatPercentPoints(drift)}
    </span>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function AskLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to="/chat"
      search={{ ask: to }}
      aria-label={label}
      className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-[var(--harbor-accent-tint)] hover:text-[var(--ws-accent-ink)]"
    >
      Ask <ArrowUpRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return <span className={value < 0 ? 'text-destructive' : 'text-success'}>{formatPercentPoints(value)}</span>;
}

function EmptySnapshot() {
  return (
    <EmptyState
      icon={<Database />}
      title="No research snapshot yet"
      description="Run pnpm research:collect to capture a dated snapshot from DefiLlama, then reload."
    />
  );
}
