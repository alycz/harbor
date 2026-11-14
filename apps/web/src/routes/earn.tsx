import type { YieldPoolRow } from '@harbor/data/research';
import { Button } from '@harbor/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight, PiggyBank } from 'lucide-react';
import { useState } from 'react';
import {
  type DepositChoice,
  DepositDialog,
  NotYetDialog,
  VAULTS,
  type Vault,
  vaultApy,
  vaultForPool,
  vaultListing,
} from '../components/earn-vaults.tsx';
import { ChainLogo, LogoPair } from '../components/protocol-logo.tsx';
import { ResearchDataTable } from '../components/research-data-table.tsx';
import { RheaDepositDialog } from '../components/rhea-deposit.tsx';
import { Chip, EmptyState, HeroCard, Panel, SectionTitle } from '../components/workspace.tsx';
import { formatApy, formatPercentPoints, formatUsd } from '../lib/format.ts';
import { type LiveEarn, lending, RHEA_SYMBOLS, type RheaSymbol } from '../lib/lending.ts';
import { research, snapshotCredit } from '../lib/research.ts';
import { apyDrift, HOME_CHAIN, projectLogo, projectName } from '../lib/research-view.ts';

/** Pools below this size are left out: their rates move too much to plan around. */
const MIN_TVL_USD = 1_000_000;
const RHEA_PROJECT = 'rhea-lend';

/** Where a Deposit button leads: a 1Click vault, or Rhea Lend on NEAR. */
type Target = { kind: 'vault'; vault: Vault } | { kind: 'rhea'; symbol: RheaSymbol };

function rheaSymbolForPool(pool: YieldPoolRow): RheaSymbol | null {
  const symbol = pool.symbol.toUpperCase();
  return pool.chain === HOME_CHAIN &&
    pool.project === RHEA_PROJECT &&
    (RHEA_SYMBOLS as readonly string[]).includes(symbol)
    ? (symbol as RheaSymbol)
    : null;
}

function targetForPool(pool: YieldPoolRow): Target | null {
  const vault = vaultForPool(pool);
  if (vault) return { kind: 'vault', vault };
  const symbol = rheaSymbolForPool(pool);
  return symbol ? { kind: 'rhea', symbol } : null;
}

/** Rhea's pool in the dated snapshot, for TVL and the 30-day mean the contract does not give. */
function rheaListing(symbol: RheaSymbol): YieldPoolRow | null {
  return (
    research.yieldPools.find(
      (pool) => pool.chain === HOME_CHAIN && pool.project === RHEA_PROJECT && pool.symbol.toUpperCase() === symbol,
    ) ?? null
  );
}

export function EarnPage() {
  const [target, setTarget] = useState<Target | null>(null);
  const [notYet, setNotYet] = useState<YieldPoolRow | null>(null);
  // Live from Rhea's contract and each vault's own source; the dated snapshot stands in until they answer.
  const live = useQuery({ queryKey: ['live-earn'], queryFn: lending.live, staleTime: 60_000 });
  const rheaLive = (symbol: RheaSymbol) => live.data?.rhea.find((market) => market.symbol === symbol) ?? null;
  const vaultLive = (vault: Vault) => live.data?.vaults.find((entry) => entry.receipt === vault.receipt) ?? null;
  const rheaApr = (symbol: RheaSymbol) => rheaLive(symbol)?.supplyAprPct ?? null;
  const choices: DepositChoice[] = [
    ...RHEA_SYMBOLS.map((symbol) => {
      const live = rheaApr(symbol);
      return {
        key: `rhea-${symbol}`,
        name: `Rhea ${symbol}`,
        detail: 'Rhea Lend on NEAR',
        chain: HOME_CHAIN,
        rate: live === null ? formatApy(rheaListing(symbol)?.totalApyPct ?? null) : `${formatApy(live)} APR`,
        onSelect: () => {
          setNotYet(null);
          setTarget({ kind: 'rhea', symbol });
        },
      };
    }),
    ...VAULTS.map((vault) => ({
      key: vault.receipt,
      name: vault.name,
      detail: `${vault.protocol} on ${vault.chain}`,
      chain: vault.chain,
      rate: vaultLive(vault) ? `${formatApy(vaultLive(vault)?.apyPct ?? null)} APY` : vaultApy(vault),
      onSelect: () => {
        setNotYet(null);
        setTarget({ kind: 'vault', vault });
      },
    })),
  ];
  const pools = stablePools(research.yieldPools);
  // Pools Harbor can deposit into lead the table; the rest keep their yield order (the sort is stable).
  const depositableFirst = [...pools].sort(
    (a, b) => Number(targetForPool(b) !== null) - Number(targetForPool(a) !== null),
  );
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
          <section aria-labelledby="earn-vaults" className="flex flex-col gap-3.5">
            <SectionTitle id="earn-vaults" title="Deposit now" />
            {live.data ? (
              <p className="-mt-1.5 text-[13px] text-muted-foreground">
                Live rates, read{' '}
                {new Date(live.data.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} from
                Rhea's contract, Morpho and Portals.
              </p>
            ) : null}
            <ul className="ws-stagger grid list-none gap-3 @xl/workspace:grid-cols-2">
              {RHEA_SYMBOLS.map((symbol) => (
                <RheaCard
                  key={symbol}
                  symbol={symbol}
                  live={rheaLive(symbol)}
                  onDeposit={() => setTarget({ kind: 'rhea', symbol })}
                />
              ))}
              {VAULTS.map((vault) => (
                <VaultCard
                  key={vault.receipt}
                  vault={vault}
                  live={vaultLive(vault)}
                  onDeposit={() => setTarget({ kind: 'vault', vault })}
                />
              ))}
            </ul>
          </section>
          <section aria-labelledby="earn-best" className="flex flex-col gap-3.5">
            <SectionTitle id="earn-best" title="Best rate by chain" />
            <ol className="ws-stagger grid list-none gap-3 @xl/workspace:grid-cols-2 @5xl/workspace:grid-cols-3">
              {best.map((pool) => (
                <RateCard key={pool.id} pool={pool} onDeposit={setTarget} onNotYet={setNotYet} />
              ))}
            </ol>
          </section>
          <section aria-labelledby="earn-all" className="flex flex-col gap-3.5">
            <SectionTitle id="earn-all" title="All stablecoin pools" />
            <ResearchDataTable<YieldPoolRow>
              tableKey="earn-stable"
              label="Stablecoin pools"
              rows={depositableFirst}
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
                {
                  id: 'deposit',
                  label: '',
                  required: true,
                  numeric: true,
                  cell: (row) => {
                    const rowTarget = targetForPool(row);
                    return (
                      <Button
                        size="sm"
                        className="h-8 px-3"
                        onClick={() => (rowTarget ? setTarget(rowTarget) : setNotYet(row))}
                      >
                        Deposit
                      </Button>
                    );
                  },
                },
              ]}
            />
          </section>
          <DepositDialog
            vault={target?.kind === 'vault' ? target.vault : null}
            onOpenChange={(open) => (open ? null : setTarget(null))}
          />
          <RheaDepositDialog
            symbol={target?.kind === 'rhea' ? target.symbol : null}
            aprPct={target?.kind === 'rhea' ? rheaApr(target.symbol) : null}
            onOpenChange={(open) => (open ? null : setTarget(null))}
          />
          <NotYetDialog pool={notYet} choices={choices} onOpenChange={(open) => (open ? null : setNotYet(null))} />
        </>
      )}
    </div>
  );
}

/** One chain's best stablecoin rate: the rate is the one big number, the pool and its context below. */
function RateCard({
  pool,
  onDeposit,
  onNotYet,
}: {
  pool: YieldPoolRow;
  onDeposit: (target: Target) => void;
  onNotYet: (pool: YieldPoolRow) => void;
}) {
  const target = targetForPool(pool);
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
      <div className="mt-4 grid grid-cols-2 border-t border-border text-[13px] font-medium">
        <Link
          to="/chat"
          search={{ ask: askAbout(pool) }}
          className="flex items-center justify-center gap-1.5 rounded-bl-[11px] border-r border-border px-3 py-3 text-[var(--ws-accent-ink)] transition-colors hover:bg-[var(--harbor-accent-tint)]"
        >
          Research on Harbor
          <ArrowUpRight
            className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Link>
        <button
          type="button"
          onClick={() => (target ? onDeposit(target) : onNotYet(pool))}
          className="flex items-center justify-center gap-1.5 rounded-br-[11px] px-3 py-3 text-[var(--ws-accent-ink)] transition-colors hover:bg-[var(--harbor-accent-tint)]"
        >
          Deposit
        </button>
      </div>
    </li>
  );
}

/** A vault Harbor can deposit into: its live rate when its source answers, else the dated snapshot. */
function VaultCard({
  vault,
  live,
  onDeposit,
}: {
  vault: Vault;
  live: LiveEarn['vaults'][number] | null;
  onDeposit: () => void;
}) {
  const lead = vaultListing(vault);
  return (
    <DepositCard
      title={vault.name}
      chain={vault.chain}
      rate={formatApy(live?.apyPct ?? lead?.totalApyPct ?? null)}
      rateLabel={live ? 'APY now' : 'APY'}
      detail={`${vault.protocol} on ${vault.chain} · pay USDC on NEAR, receive ${vault.receipt}`}
      figures={[
        { label: 'TVL', value: formatUsd(live?.tvlUsd ?? lead?.tvlUsd ?? null) },
        lead?.mean30dApyPct != null
          ? { label: '30d mean', value: formatApy(lead.mean30dApyPct) }
          : { label: 'Source', value: lead?.source === 'portals-explorer' ? 'Portals' : 'DefiLlama' },
        { label: 'Minimum', value: '~50 USDC' },
      ]}
      ask={`Tell me about ${vault.name} (${vault.protocol} on ${vault.chain}): the risks, fees and how I would exit.`}
      onDeposit={onDeposit}
    />
  );
}

/** Rhea Lend on NEAR: the live supply rate from its contract, with the snapshot's TVL and mean beside it. */
function RheaCard({
  symbol,
  live,
  onDeposit,
}: {
  symbol: RheaSymbol;
  live: LiveEarn['rhea'][number] | null;
  onDeposit: () => void;
}) {
  const listing = rheaListing(symbol);
  return (
    <DepositCard
      title={`Rhea ${symbol}`}
      chain={HOME_CHAIN}
      rate={formatApy(live?.supplyAprPct ?? listing?.totalApyPct ?? null)}
      rateLabel={live ? 'APR now' : 'APY'}
      detail={`Rhea Lend on NEAR · supply ${symbol} from your wallet, never as collateral`}
      figures={[
        // A stablecoin market: tokens supplied stand in for dollars.
        { label: 'Supplied', value: formatUsd(live?.supplied ?? listing?.tvlUsd ?? null) },
        { label: '30d mean', value: formatApy(listing?.mean30dApyPct ?? null) },
        { label: 'Minimum', value: 'None' },
      ]}
      ask={`Tell me about supplying ${symbol} on Rhea Lend (NEAR): the current rate, the risks and how I would withdraw.`}
      onDeposit={onDeposit}
    />
  );
}

function DepositCard({
  title,
  chain,
  rate,
  rateLabel,
  detail,
  figures,
  ask,
  onDeposit,
}: {
  title: string;
  chain: string;
  rate: string;
  rateLabel: string;
  detail: string;
  figures: { label: string; value: string }[];
  ask: string;
  onDeposit: () => void;
}) {
  return (
    <li className="ws-card flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <p className="flex items-center gap-2 text-[13.5px] font-medium">
          <ChainLogo chain={chain} className="size-5" />
          {title}
        </p>
      </div>
      <div className="px-5 pt-5">
        <p className="flex items-baseline gap-2.5">
          <span className="text-[38px] leading-none font-medium tracking-[-0.035em] [font-variant-numeric:proportional-nums]">
            {rate}
          </span>
          <span className="text-[12.5px] text-muted-foreground">{rateLabel}</span>
        </p>
        <p className="mt-3.5 text-[13.5px] text-muted-foreground">{detail}</p>
      </div>
      <dl className="mx-5 mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3.5 text-[12.5px]">
        {figures.map((figure) => (
          <Figure key={figure.label} label={figure.label} value={figure.value} />
        ))}
      </dl>
      <div className="mt-4 grid grid-cols-2 border-t border-border text-[13px] font-medium">
        <Link
          to="/chat"
          search={{ ask }}
          className="flex items-center justify-center gap-1.5 rounded-bl-[11px] border-r border-border px-3 py-3 text-[var(--ws-accent-ink)] transition-colors hover:bg-[var(--harbor-accent-tint)]"
        >
          Research on Harbor <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={onDeposit}
          className="flex items-center justify-center gap-1.5 rounded-br-[11px] px-3 py-3 text-[var(--ws-accent-ink)] transition-colors hover:bg-[var(--harbor-accent-tint)]"
        >
          Deposit
        </button>
      </div>
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
