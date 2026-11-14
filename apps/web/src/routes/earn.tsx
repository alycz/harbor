import type { YieldPoolRow } from '@harbor/data/research';
import { Button } from '@harbor/ui/components/button';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight, PiggyBank } from 'lucide-react';
import { EarnVaults } from '../components/earn-vaults.tsx';
import { IntegrationDemo } from '../components/integration-demo.tsx';
import { ChainLogo, LogoPair } from '../components/protocol-logo.tsx';
import { ResearchDataTable } from '../components/research-data-table.tsx';
import { Chip, EmptyState, HeroCard, Panel, SectionTitle } from '../components/workspace.tsx';
import { formatApy, formatPercentPoints, formatUsd } from '../lib/format.ts';
import { research, snapshotCredit } from '../lib/research.ts';
import { apyDrift, HOME_CHAIN, projectLogo, projectName } from '../lib/research-view.ts';

/** Pools below this size are left out: their rates move too much to plan around. */
const MIN_TVL_USD = 1_000_000;

export function EarnPage() {
  const pools = stablePools(research.yieldPools);
  const best = bestPerChain(pools);
  const top = best.reduce<YieldPoolRow | null>(
    (leader, pool) => (leader === null || (pool.totalApyPct ?? 0) > (leader.totalApyPct ?? 0) ? pool : leader),
    null,
  );
  const home = best.find((pool) => pool.chain === HOME_CHAIN);
  return (
    <div className="ws-stagger flex flex-col gap-8">
      <HeroCard
        title="The best stablecoin rate on each chain, side by side."
        footer={snapshotCredit()}
        stats={[
          { label: 'Best rate', value: top ? formatApy(top.totalApyPct) : '—' },
          { label: 'On NEAR', value: home ? formatApy(home.totalApyPct) : '—' },
          { label: 'Chains', value: best.length },
        ]}
        actions={
          <Button
            nativeButton={false}
            className="h-10 gap-2 px-4"
            render={<Link to="/chat" search={{ ask: 'Where should I park 100 USDC across chains, and why?' }} />}
          >
            Ask where to park 100 USDC <ArrowRight />
          </Button>
        }
      />
      <IntegrationDemo />
      {best.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<PiggyBank />}
            title="No stablecoin pools in the snapshot"
            description="Run pnpm research:collect to capture a dated snapshot, then reload."
          />
        </Panel>
      ) : (
        <>
          <EarnVaults />
          <section aria-labelledby="earn-best" className="flex flex-col gap-3.5">
            <SectionTitle id="earn-best" title="Best rate by chain" />
            <ol className="ws-stagger grid list-none gap-3 @xl/workspace:grid-cols-2 @5xl/workspace:grid-cols-3">
              {best.map((pool) => (
                <RateCard key={pool.id} pool={pool} />
              ))}
            </ol>
          </section>
          <section aria-labelledby="earn-all" className="flex flex-col gap-3.5">
            <SectionTitle id="earn-all" title="All stablecoin pools" />
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
                    <div className="flex items-center gap-3">
                      <LogoPair
                        className="size-8"
                        primary={{ name: projectName(row.project), url: projectLogo(row.project) }}
                      />
                      <div className="min-w-0">
                        <p className="font-medium">{row.symbol}</p>
                        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
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
                { id: 'apy', label: 'APY', numeric: true, emphasis: true, cell: (row) => formatApy(row.totalApyPct) },
                {
                  id: 'mean',
                  label: '30d mean',
                  numeric: true,
                  cell: (row) => <span className="text-muted-foreground">{formatApy(row.mean30dApyPct)}</span>,
                },
                { id: 'tvl', label: 'TVL', numeric: true, cell: (row) => formatUsd(row.tvlUsd) },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}

/** One chain's best stablecoin rate: the rate is the one big number, the pool and its context below. */
function RateCard({ pool }: { pool: YieldPoolRow }) {
  const drift = apyDrift(pool);
  const home = pool.chain === HOME_CHAIN;
  return (
    <li
      className={`group ws-card flex flex-col transition-[box-shadow,translate,border-color] duration-200 hover:-translate-y-px hover:border-border-strong hover:shadow-[var(--ws-shadow-raised)] motion-reduce:hover:translate-y-0`}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <p className="flex items-center gap-2 text-[13.5px] font-medium">
          <ChainLogo chain={pool.chain} className="size-5" />
          {pool.chain}
        </p>
        {home ? <Chip tone="accent">Home chain</Chip> : null}
      </div>
      <div className="px-5 pt-5">
        <p className="flex items-baseline gap-2.5">
          <span className="text-[38px] leading-none font-medium tracking-[-0.035em] [font-variant-numeric:proportional-nums]">
            {formatApy(pool.totalApyPct)}
          </span>
          <span className="text-[12.5px] text-muted-foreground">APY</span>
          {drift !== null && Math.abs(drift) >= 0.05 ? (
            <span
              className={`ml-auto text-[12px] font-medium ${drift > 0 ? 'text-success' : 'text-destructive'}`}
              title="Against the pool's 30-day mean"
            >
              {formatPercentPoints(drift)} vs 30d
            </span>
          ) : null}
        </p>
        <p className="mt-3.5 flex items-center gap-2 text-[13.5px]">
          <LogoPair className="size-5" primary={{ name: projectName(pool.project), url: projectLogo(pool.project) }} />
          <span className="truncate">
            <span className="font-medium">{pool.symbol}</span>
            <span className="text-muted-foreground"> on {projectName(pool.project)}</span>
          </span>
        </p>
      </div>
      <dl className="mx-5 mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3.5 text-[12.5px]">
        <Figure label="TVL" value={formatUsd(pool.tvlUsd)} />
        <Figure label="30d mean" value={formatApy(pool.mean30dApyPct)} />
        <Figure label="Rewards" value={formatApy(pool.rewardApyPct)} />
      </dl>
      <Link
        to="/chat"
        search={{ ask: askAbout(pool) }}
        className="mt-4 flex items-center justify-between gap-2 rounded-b-[11px] border-t border-border px-5 py-3 text-[13px] font-medium text-[var(--ws-accent-ink)] transition-colors hover:bg-[var(--harbor-accent-tint)]"
      >
        Compare with Harbor
        <ArrowUpRight
          className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ws-num mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function askAbout(pool: YieldPoolRow): string {
  return `I have idle ${pool.symbol}. Compare parking it on ${projectName(pool.project)} (${pool.chain}) with the best alternatives on other chains, including fees, risks and how I would exit.`;
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
