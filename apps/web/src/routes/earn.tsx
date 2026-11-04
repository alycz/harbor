import type { YieldPoolRow } from '@harbor/data/research';
import { Button } from '@harbor/ui/components/button';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

import { Panel } from '../components/brand.tsx';
import { ResearchDataTable } from '../components/research-data-table.tsx';
import { EmptyState, PageHeader } from '../components/workspace.tsx';
import { formatApy, formatUsd } from '../lib/format.ts';
import { research } from '../lib/research.ts';
import { SnapshotNotice } from './research.tsx';

/** Pools below this size are left out: their rates move too much to plan around. */
const MIN_TVL_USD = 1_000_000;
const HOME_CHAIN = 'NEAR';

export function EarnPage() {
  const pools = stablePools(research.yieldPools);
  const best = bestPerChain(pools);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Earn"
        kicker="Park idle stablecoins"
        description="Where idle stablecoins earned the most on each chain Harbor can reach. Ask Harbor to compare venues for your amount; you sign anything it proposes."
        meta={<SnapshotNotice />}
        actions={
          <Button
            nativeButton={false}
            className="h-14 justify-between gap-8 px-[22px] text-sm"
            render={<Link to="/chat" search={{ ask: 'Where should I park 100 USDC across chains, and why?' }} />}
          >
            Ask Harbor <ArrowRight />
          </Button>
        }
      />
      {best.length === 0 ? (
        <Panel label="Stablecoin rates">
          <EmptyState
            title="No stablecoin pools in the snapshot"
            description="Run pnpm research:collect to capture a dated snapshot, then reload."
          />
        </Panel>
      ) : (
        <>
          <Panel
            label="Best stablecoin rate by chain"
            aside={`Pools over ${formatUsd(MIN_TVL_USD)} TVL`}
            bodyClassName="p-0"
            className="overflow-hidden"
            labelId="earn-best"
          >
            <ol className="grid list-none sm:grid-cols-2 xl:grid-cols-3">
              {best.map((pool) => (
                <li key={pool.id} className="-mr-px -mb-px flex flex-col gap-5 border-r border-b border-line p-6">
                  <p className="flex items-center justify-between gap-3 text-[11px] font-medium tracking-[0.6px] uppercase">
                    <span>{pool.chain}</span>
                    {pool.chain === HOME_CHAIN ? <span className="text-primary">Home chain</span> : null}
                  </p>
                  <div>
                    <p className="font-serif text-[46px] leading-none font-bold tracking-[-2px] text-primary">
                      {formatApy(pool.totalApyPct)}
                    </p>
                    <p className="mt-3 text-sm">
                      {pool.symbol} on {pool.project}
                      {pool.meta ? <span className="text-muted-foreground"> · {pool.meta}</span> : null}
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4 text-xs">
                    <Figure label="TVL" value={formatUsd(pool.tvlUsd)} />
                    <Figure label="30d mean" value={formatApy(pool.mean30dApyPct)} />
                    <Figure label="Rewards" value={formatApy(pool.rewardApyPct)} />
                  </dl>
                  <Link
                    to="/chat"
                    search={{ ask: askAbout(pool) }}
                    className="mt-auto inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    Compare this with Harbor <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ol>
          </Panel>
          <section aria-labelledby="earn-all" className="flex flex-col gap-4">
            <h2 id="earn-all" className="text-[28px] leading-none tracking-[-1px] uppercase">
              All stablecoin pools
            </h2>
            <ResearchDataTable<YieldPoolRow>
              tableKey="earn-stable"
              label="Stablecoin pools"
              rows={pools}
              getRowId={(row) => row.id}
              columns={[
                {
                  id: 'pool',
                  label: 'Pool',
                  required: true,
                  cell: (row) => (
                    <div>
                      <p className="font-medium">{row.symbol}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.project}
                        {row.meta ? ` · ${row.meta}` : ''}
                      </p>
                    </div>
                  ),
                },
                { id: 'chain', label: 'Chain', cell: (row) => row.chain },
                { id: 'apy', label: 'APY', numeric: true, emphasis: true, cell: (row) => formatApy(row.totalApyPct) },
                { id: 'mean', label: '30d mean', numeric: true, cell: (row) => formatApy(row.mean30dApyPct) },
                { id: 'tvl', label: 'TVL', numeric: true, cell: (row) => formatUsd(row.tvlUsd) },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 tabular-nums">{value}</dd>
    </div>
  );
}

function askAbout(pool: YieldPoolRow): string {
  return `I have idle ${pool.symbol}. Compare parking it on ${pool.project} (${pool.chain}) with the best alternatives on other chains, including fees, risks and how I would exit.`;
}

/** Stablecoin pools large enough to plan around, highest yield first. */
function stablePools(pools: readonly YieldPoolRow[]): YieldPoolRow[] {
  return pools
    .filter((pool) => pool.stablecoin && pool.totalApyPct !== null && (pool.tvlUsd ?? 0) >= MIN_TVL_USD)
    .sort((a, b) => (b.totalApyPct ?? -1) - (a.totalApyPct ?? -1));
}

/** The highest-yield pool on each chain, NEAR first, then by yield. */
function bestPerChain(pools: readonly YieldPoolRow[]): YieldPoolRow[] {
  const best = new Map<string, YieldPoolRow>();
  for (const pool of pools) if (!best.has(pool.chain)) best.set(pool.chain, pool);
  return [...best.values()].sort((a, b) =>
    a.chain === HOME_CHAIN ? -1 : b.chain === HOME_CHAIN ? 1 : (b.totalApyPct ?? -1) - (a.totalApyPct ?? -1),
  );
}
