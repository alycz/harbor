import type { DataCard } from '@harbor/agent-runtime/events';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, MessageSquarePlus } from 'lucide-react';

import { formatApy, formatUsd } from '../lib/format.ts';
import { projectLogo, projectName } from '../lib/research-view.ts';
import { AssetIcon } from './asset-icon.tsx';
import { chainName } from './asset-select.tsx';
import { ChainLogo, LogoPair } from './protocol-logo.tsx';
import { Chip } from './workspace.tsx';
import { useWorkspaceSession } from './workspace-session.tsx';

/** The protocol behind each live deposit, for its logo. */
const DEPOSIT_PROJECTS: Record<string, string> = {
  'Gauntlet USDC Prime': 'morpho-blue',
  'Taler USDC': 'taler-finance',
};

/**
 * Data a read tool returned, shown as cards inside Harbor's answer. The rows come from the tool's own
 * result, so these figures are what Harbor read, whatever the prose around them says.
 */
export function ChatDataCard({ card }: { card: DataCard }) {
  if (card.kind === 'deposits') return <DepositCards card={card} />;
  if (card.kind === 'borrow_markets') return <BorrowCards card={card} />;
  return <PoolCards card={card} />;
}

function CardFrame({
  title,
  meta,
  live,
  children,
}: {
  title: string;
  meta: string;
  live: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <p className="text-[13px] font-medium">{title}</p>
        <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
          {meta}
          <Chip tone={live ? 'success' : 'neutral'} dot={live}>
            {live ? 'Live' : 'Snapshot'}
          </Chip>
        </span>
      </header>
      {children}
    </section>
  );
}

function DepositCards({ card }: { card: Extract<DataCard, { kind: 'deposits' }> }) {
  const { setDraft } = useWorkspaceSession();
  const best = Math.max(...card.items.map((item) => item.ratePct));
  const sorted = [...card.items].sort((a, b) => b.ratePct - a.ratePct);
  return (
    <CardFrame title="Where Harbor can deposit" meta={`Read ${clock(card.fetchedAt)}`} live>
      <ul className="grid gap-px bg-border @xl/workspace:grid-cols-2">
        {sorted.map((item) => {
          const project = item.protocol === 'rhea-lending' ? 'rhea-lend' : (DEPOSIT_PROJECTS[item.name] ?? 'unknown');
          return (
            <li key={item.name} className="flex flex-col gap-3 bg-card px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <LogoPair
                    className="size-8"
                    primary={{ name: projectName(project), url: projectLogo(project) }}
                    secondary={{ name: item.chain }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium">{item.name}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {item.asset} on {item.chain}
                    </span>
                  </span>
                </span>
                {item.ratePct === best && card.items.length > 1 ? <Chip tone="accent">Highest</Chip> : null}
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="ws-num flex items-baseline gap-1.5">
                  <span className="text-[26px] leading-none font-medium tracking-[-0.02em]">
                    {formatApy(item.ratePct)}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{item.rateKind}</span>
                </p>
                <p className="ws-num text-[12.5px] text-muted-foreground">{formatUsd(item.sizeUsd)} in pool</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDraft(`Queue a ${item.asset} deposit into ${item.name}`)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] px-2.5 text-[12.5px] font-medium text-[var(--ws-accent-ink)] transition-colors hover:bg-[color-mix(in_oklab,var(--harbor-accent-tint),var(--harbor-accent)_8%)]"
                >
                  <MessageSquarePlus className="size-3.5" aria-hidden="true" /> Queue in chat
                </button>
                <Link
                  to="/earn"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Open on Earn <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </CardFrame>
  );
}

function BorrowCards({ card }: { card: Extract<DataCard, { kind: 'borrow_markets' }> }) {
  const { setDraft } = useWorkspaceSession();
  return (
    <CardFrame title="Templar borrow markets" meta={`${card.items.length} active`} live>
      <ul className="divide-y divide-border">
        {card.items.map((market) => {
          const borrow = market.borrow.symbol ?? 'Unknown';
          const collateral = market.collateral.symbol ?? 'Unknown';
          return (
            <li key={market.marketId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="flex shrink-0 -space-x-1.5">
                <span className="rounded-full bg-card p-px">
                  <AssetIcon symbol={borrow} className="size-7" />
                </span>
                <span className="rounded-full bg-card p-px">
                  <AssetIcon symbol={collateral} className="size-7" />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px]">
                  Borrow <span className="font-medium">{borrow}</span>
                  <span className="text-muted-foreground"> against </span>
                  <span className="font-medium">{collateral}</span>
                </span>
                <span className="block truncate font-mono text-[11.5px] text-muted-foreground">{market.marketId}</span>
              </span>
              <span className="text-[12px] text-muted-foreground">
                {market.borrow.chain ? chainName(market.borrow.chain) : ''}
              </span>
              <button
                type="button"
                onClick={() => setDraft(`Borrow ${borrow} on Templar market ${market.marketId}`)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <MessageSquarePlus className="size-3.5" aria-hidden="true" /> Ask to borrow
              </button>
            </li>
          );
        })}
      </ul>
    </CardFrame>
  );
}

function PoolCards({ card }: { card: Extract<DataCard, { kind: 'yield_pools' }> }) {
  return (
    <CardFrame
      title="Yield pools"
      meta={card.capturedAt ? `Captured ${new Date(card.capturedAt).toUTCString().slice(5, 22)} UTC` : ''}
      live={false}
    >
      <ul className="divide-y divide-border">
        {card.items.map((pool) => (
          <li key={`${pool.project}-${pool.chain}-${pool.asset}`} className="flex items-center gap-3 px-4 py-2.5">
            <LogoPair
              className="size-7"
              primary={{ name: projectName(pool.project), url: projectLogo(pool.project) }}
              secondary={{ name: pool.chain }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{pool.asset}</span>
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                {projectName(pool.project)} on <ChainLogo chain={pool.chain} className="size-3.5" /> {pool.chain}
              </span>
            </span>
            <span className="text-right">
              <span className="ws-num block text-[14px] font-medium">{formatApy(pool.apyPct)}</span>
              <span className="ws-num block text-[11.5px] text-muted-foreground">{formatUsd(pool.tvlUsd)} TVL</span>
            </span>
          </li>
        ))}
      </ul>
    </CardFrame>
  );
}

function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${date.toISOString().slice(11, 16)} UTC`;
}
