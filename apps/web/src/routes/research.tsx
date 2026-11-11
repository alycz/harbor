import type { ProtocolRow, YieldPoolRow } from '@harbor/data/research';
import { Input } from '@harbor/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@harbor/ui/components/select';
import { Tabs, TabsContent } from '@harbor/ui/components/tabs';
import { Link } from '@tanstack/react-router';
import { ArrowDownRight, ArrowUpRight, Database, Search, Telescope } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { PoolDialog, poolPrompt } from '../components/pool-dialog.tsx';
import { ChainLogo, chainLogoUrl, LogoPair, ProtocolLogo } from '../components/protocol-logo.tsx';
import { ResearchDataTable } from '../components/research-data-table.tsx';
import { EmptyState, HeroCard, Panel, SectionTitle, Segment, SegmentedList, Toggle } from '../components/workspace.tsx';
import { formatApy, formatPercentPoints, formatUsd } from '../lib/format.ts';
import { research, snapshotCredit } from '../lib/research.ts';
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
        title="Yields and protocols across every chain Harbor can reach."
        footer={snapshotCredit()}
        stats={
          empty
            ? [{ label: 'Snapshot', value: 'None yet' }]
            : [
                { label: 'DeFi TVL', value: formatUsd(totalTvl) },
                { label: 'Chains', value: chains.length },
                { label: 'Yield pools', value: research.yieldPools.length },
              ]
        }
      />
      {empty ? (
        <Panel>
          <EmptySnapshot />
        </Panel>
      ) : (
        <Tabs value={view} onValueChange={(next) => setView(String(next))} className="gap-3.5">
          <SectionTitle
            id="research-table"
            title={view === 'yields' ? 'Yield pools' : 'Protocols'}
            actions={
              <>
                <ChainSelect chains={chains} selected={chain} onSelect={setChain} totalTvl={totalTvl} />
                <SegmentedList label="Research views">
                  <Segment value="yields">Yield pools</Segment>
                  <Segment value="protocols">Protocols</Segment>
                </SegmentedList>
              </>
            }
          />
          <TabsContent value="yields">
            <YieldTable chain={chain} />
          </TabsContent>
          <TabsContent value="protocols">
            <ProtocolTable chain={chain} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

/** Which chain the tables show: every chain, or one, each with its DeFi TVL beside it. */
function ChainSelect({
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
  const options = [{ name: ALL, tvl: totalTvl }, ...chains];
  const current = options.find((option) => option.name === selected) ?? options[0];
  return (
    <Select value={selected} onValueChange={(next) => next !== null && onSelect(String(next))}>
      <SelectTrigger
        aria-label="Filter by chain"
        className="h-9 min-w-48 gap-2.5 rounded-lg bg-card pr-3 pl-2.5 text-[13px] font-medium data-[size=default]:h-9"
      >
        <SelectValue>{current ? <ChainOption name={current.name} /> : null}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="max-h-96 min-w-72 p-2">
        {options.map((option) => (
          <SelectItem
            key={option.name}
            value={option.name}
            className="min-h-11 rounded-lg py-2 pr-10 pl-3 text-[13.5px]"
          >
            <span className="flex w-full items-center justify-between gap-6">
              <ChainOption name={option.name} />
              <span className="ws-num text-[12.5px] text-muted-foreground">{formatUsd(option.tvl)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChainOption({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2">
      {name === ALL ? (
        <span
          aria-hidden="true"
          className="grid size-5 place-items-center rounded-full bg-secondary text-muted-foreground"
        >
          <Telescope className="size-3" />
        </span>
      ) : (
        <ChainLogo chain={name} className="size-5" />
      )}
      {name === ALL ? 'All chains' : name}
    </span>
  );
}

/** A search field with its icon inside, for the table toolbars. */
function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative w-full @xl/workspace:w-64">
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
  const [open, setOpen] = useState<YieldPoolRow | null>(null);
  const rows = research.yieldPools
    .filter((pool) => chain === ALL || pool.chain === chain)
    .filter((pool) => !stableOnly || pool.stablecoin)
    .filter((pool) =>
      `${pool.project} ${projectName(pool.project)} ${pool.symbol}`.toLowerCase().includes(query.toLowerCase().trim()),
    )
    .sort((a, b) => (b.totalApyPct ?? -1) - (a.totalApyPct ?? -1));
  return (
    <>
      <PoolDialog pool={open} onOpenChange={(next) => !next && setOpen(null)} onSelect={setOpen} />
      <ResearchDataTable<YieldPoolRow>
        tableKey="research-yields"
        label="Yield pools"
        rows={rows}
        getRowId={(row) => row.id}
        onRowClick={setOpen}
        controls={
          <>
            <SearchField label="Search project or asset" value={query} onChange={setQuery} />
            <Toggle checked={stableOnly} onChange={setStableOnly}>
              Stablecoins only
            </Toggle>
          </>
        }
        columns={[
          {
            id: 'pool',
            label: 'Pool',
            required: true,
            cell: (row) => (
              <button
                type="button"
                onClick={() => setOpen(row)}
                aria-label={`Open ${row.symbol} on ${projectName(row.project)}, ${row.chain}`}
                className="flex w-full min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <LogoPair
                  className="size-8"
                  primary={{ name: projectName(row.project), url: projectLogo(row.project) }}
                  secondary={{ name: row.chain, url: chainLogoUrl(row.chain) }}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium" title={row.symbol}>
                    {row.symbol}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                    {projectName(row.project)}
                    {row.meta ? ` · ${row.meta}` : ''}
                  </span>
                </span>
              </button>
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
          {
            id: 'reward',
            label: 'Rewards',
            numeric: true,
            cell: (row) => <Muted>{formatApy(row.rewardApyPct)}</Muted>,
          },
          {
            id: 'tvl',
            label: 'TVL',
            numeric: true,
            cell: (row) => (row.tvlUsd === null ? '—' : formatUsd(row.tvlUsd)),
          },
          {
            id: 'ask',
            label: 'Ask Harbor',
            numeric: true,
            cell: (row) => (
              <AskLink to={poolPrompt(row)} label={`Ask Harbor about ${row.symbol} on ${projectName(row.project)}`} />
            ),
          },
        ]}
      />
    </>
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
    <span className="inline-flex items-center gap-3">
      <span className="min-w-[4.5rem]">{formatUsd(value)}</span>
      <span
        aria-hidden="true"
        className="hidden h-1 w-14 overflow-hidden rounded-full bg-secondary @xl/workspace:block"
      >
        <span
          className="block h-full rounded-full bg-foreground/70"
          style={{ width: `${Math.max(4, (value / max) * 100)}%` }}
        />
      </span>
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
      className="-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-[var(--harbor-accent-tint)] hover:text-[var(--ws-accent-ink)]"
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
