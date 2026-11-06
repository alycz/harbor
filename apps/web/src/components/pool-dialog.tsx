import type { YieldPoolRow } from '@harbor/data/research';
import { Button } from '@harbor/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@harbor/ui/components/dialog';
import { Link } from '@tanstack/react-router';
import { ArrowDownRight, ArrowUpRight, ExternalLink, MessageCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatApy, formatPercentPoints, formatUsd, formatUtc } from '../lib/format.ts';
import { research } from '../lib/research.ts';
import { apyDrift, projectLogo, projectName } from '../lib/research-view.ts';
import { RollingNumber } from './motion.tsx';
import { ChainLogo, chainLogoUrl, LogoPair, ProtocolLogo } from './protocol-logo.tsx';
import { Chip, FactRow } from './workspace.tsx';

/*
 * A pool's market page, Royco style, in a dialog over the table. Every figure is from the dated
 * snapshot: there is no APY history in it, so instead of a time series the charts place the pool
 * among its peers, against its own 30-day mean, and split into base and rewards.
 */

const PROTOCOLS = new Map(research.protocols.map((protocol) => [protocol.slug, protocol]));

export function poolPrompt(pool: YieldPoolRow): string {
  return `Compare ${pool.symbol} on ${projectName(pool.project)} (${pool.chain}) with similar pools. What are the risks, and how would I exit?`;
}

export function PoolDialog({
  pool,
  onOpenChange,
  onSelect,
}: {
  pool: YieldPoolRow | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (pool: YieldPoolRow) => void;
}) {
  return (
    <Dialog open={pool !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="ws-pool-dialog max-w-[880px] gap-0 border-border bg-background p-0 sm:max-h-[calc(100svh-4rem)]"
      >
        {pool ? <PoolMarket pool={pool} onSelect={onSelect} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PoolMarket({
  pool,
  onSelect,
  onClose,
}: {
  pool: YieldPoolRow;
  onSelect: (pool: YieldPoolRow) => void;
  onClose: () => void;
}) {
  const protocol = PROTOCOLS.get(pool.project);
  const name = projectName(pool.project);
  return (
    <div key={pool.id} className="ws-stagger flex flex-col gap-3 p-3 sm:p-4">
      {/* Header: identity on the left, close on the right, the snapshot date beside the protocol line. */}
      <section className="ws-card p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <LogoPair
            className="size-11"
            primary={{ name, url: projectLogo(pool.project) }}
            secondary={{ name: pool.chain, url: chainLogoUrl(pool.chain) }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <DialogTitle className="font-display text-[26px] leading-tight [overflow-wrap:anywhere]">
                {pool.symbol}
              </DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close"
                className="-mt-1 -mr-2 size-9 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="size-[18px]" />
              </Button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
                <span>
                  {name}
                  {pool.meta ? ` · ${pool.meta}` : ''}
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <ChainLogo chain={pool.chain} className="size-4" /> {pool.chain}
                </span>
                {protocol ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{protocol.category}</span>
                  </>
                ) : null}
              </DialogDescription>
              <div className="flex flex-wrap gap-1.5">
                {pool.stablecoin ? <Chip tone="accent">Stablecoin</Chip> : null}
                <Chip>Snapshot {formatUtc(pool.observedAt)}</Chip>
              </div>
            </div>
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-5">
          <Kpi label="Pool TVL" value={formatUsd(pool.tvlUsd)} />
          <Kpi label="Total APY" value={formatApy(pool.totalApyPct)} strong />
          <Kpi label="Base APY" value={formatApy(pool.baseApyPct)} />
          <Kpi label="Reward APY" value={formatApy(pool.rewardApyPct)} />
          <Kpi label="30d mean" value={formatApy(pool.mean30dApyPct)} />
        </dl>
      </section>

      <section className="ws-card p-5">
        <PeerStrip pool={pool} />
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="ws-card flex flex-col gap-5 p-5">
          <MeanBars pool={pool} />
        </section>
        <section className="ws-card flex flex-col gap-5 p-5">
          <Composition pool={pool} />
        </section>
      </div>
      <ProtocolPanel pool={pool} />
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="ws-card px-5 py-2">
          <dl>
            <FactRow label="Stablecoin pool" value={pool.stablecoin ? 'Yes' : 'No'} />
            <FactRow label="Underlying tokens" value={<Tokens tokens={pool.underlyingTokens} />} />
            <FactRow label="Source" value="DefiLlama Yields" />
          </dl>
        </section>
        <section className="ws-card p-5">
          <SimilarPools pool={pool} onSelect={onSelect} />
        </section>
      </div>

      <footer className="sticky bottom-0 z-10 -mx-3 -mb-3 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md sm:-mx-4 sm:-mb-4 sm:px-5">
        <ExternalButton href={`https://defillama.com/yields/pool/${encodeURIComponent(pool.id)}`}>
          View on DefiLlama
        </ExternalButton>
        {protocol?.url ? <ExternalButton href={protocol.url}>Open {protocol.name}</ExternalButton> : null}
        <Button
          nativeButton={false}
          render={<Link to="/chat" search={{ ask: poolPrompt(pool) }} />}
          className="h-10 gap-2 px-4"
        >
          <MessageCircle /> Ask Harbor about this pool
        </Button>
      </footer>
    </div>
  );
}

function Kpi({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
      <dd className={`ws-num mt-1 truncate text-[19px] tracking-[-0.01em] ${strong ? 'font-semibold' : 'font-medium'}`}>
        <RollingNumber value={value} />
      </dd>
    </div>
  );
}

function ChartHead({ label, value, aside }: { label: string; value: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className="ws-num mt-1 text-[24px] font-medium tracking-[-0.02em]">{value}</p>
      </div>
      {aside}
    </div>
  );
}

/**
 * Every comparable pool as a tick on one axis, this one raised and labelled: how unusual its yield
 * is reads at a glance. Stablecoin pools are compared with stablecoin pools.
 */
function PeerStrip({ pool }: { pool: YieldPoolRow }) {
  const peers = research.yieldPools.filter(
    (other) => other.totalApyPct !== null && other.stablecoin === pool.stablecoin,
  );
  const values = peers.map((other) => other.totalApyPct ?? 0).sort((a, b) => a - b);
  const apy = pool.totalApyPct;
  if (apy === null || values.length < 2) {
    return <ChartHead label="Against similar pools" value="—" />;
  }
  // The axis stops at the 97th percentile so one outlier can't flatten the rest.
  const cap = Math.max(apy, values[Math.floor(values.length * 0.97)] ?? apy, 1);
  const x = (value: number) => `${(Math.min(value, cap) / cap) * 100}%`;
  const below = values.filter((value) => value < apy).length;
  const rank = Math.round((below / values.length) * 100);
  const median = values[Math.floor(values.length / 2)] ?? 0;
  const group = pool.stablecoin ? 'stablecoin pools' : 'non-stablecoin pools';
  return (
    <div className="flex flex-col gap-5">
      <ChartHead
        label="Against similar pools"
        value={`Higher than ${rank}%`}
        aside={
          <p className="text-[12.5px] text-muted-foreground">
            of {values.length} {group} · median {formatApy(median)}
          </p>
        }
      />
      <div className="relative h-16" role="img" aria-label={`${pool.symbol} yields more than ${rank}% of ${group}`}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {peers.map((other) => (
          <span
            key={other.id}
            className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-foreground/20"
            style={{ left: x(other.totalApyPct ?? 0) }}
          />
        ))}
        <span
          className="absolute top-1/2 h-8 w-px -translate-y-1/2 bg-muted-foreground/60"
          style={{ left: x(median) }}
        />
        <span
          className="ws-pool-marker absolute top-1/2 grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary ring-4 ring-[var(--harbor-accent-tint)]"
          style={{ left: x(apy) }}
        />
        <span
          className="ws-num absolute -top-1 -translate-x-1/2 rounded-md bg-primary px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap text-primary-foreground"
          style={{ left: `clamp(2rem, ${x(apy)}, calc(100% - 2rem))` }}
        >
          {formatApy(apy)}
        </span>
      </div>
      <div className="ws-num -mt-3 flex justify-between text-[11.5px] text-muted-foreground">
        <span>0%</span>
        <span>{formatApy(cap)}+</span>
      </div>
    </div>
  );
}

/** Today's APY beside its 30-day mean, as two bars on one scale. */
function MeanBars({ pool }: { pool: YieldPoolRow }) {
  const drift = apyDrift(pool);
  const max = Math.max(pool.totalApyPct ?? 0, pool.mean30dApyPct ?? 0, 0.01);
  const Icon = drift !== null && drift < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <>
      <ChartHead
        label="Now against its 30-day mean"
        value={
          drift === null ? (
            '—'
          ) : (
            <span className={`inline-flex items-center gap-1 ${drift < 0 ? 'text-destructive' : 'text-success'}`}>
              <Icon className="size-5" aria-hidden="true" />
              {formatPercentPoints(drift)}
            </span>
          )
        }
      />
      <div className="flex flex-col gap-3">
        <Bar label="Now" value={pool.totalApyPct} max={max} tone="bg-primary" />
        <Bar label="30d mean" value={pool.mean30dApyPct} max={max} tone="bg-foreground/25" />
      </div>
    </>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number | null; max: number; tone: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-secondary">
        <span
          className={`ws-pool-bar block h-full rounded-full ${tone}`}
          style={{ width: `${value === null ? 0 : Math.max(2, (value / max) * 100)}%` }}
        />
      </span>
      <span className="ws-num text-right font-medium">{formatApy(value)}</span>
    </div>
  );
}

/** Where the yield comes from: the protocol's own base rate, or token rewards that can stop. */
function Composition({ pool }: { pool: YieldPoolRow }) {
  const base = Math.max(0, pool.baseApyPct ?? 0);
  const reward = Math.max(0, pool.rewardApyPct ?? 0);
  const total = base + reward;
  const baseShare = total > 0 ? (base / total) * 100 : 0;
  return (
    <>
      <ChartHead label="Where the yield comes from" value={total > 0 ? `${Math.round(baseShare)}% base` : '—'} />
      <div className="flex flex-col gap-3">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-secondary">
          <span className="ws-pool-bar h-full bg-primary" style={{ width: `${baseShare}%` }} />
          <span className="ws-pool-bar h-full bg-warning/70" style={{ width: `${total > 0 ? 100 - baseShare : 0}%` }} />
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
          <Legend tone="bg-primary" label="Base" value={formatApy(pool.baseApyPct)} />
          <Legend tone="bg-warning/70" label="Rewards" value={formatApy(pool.rewardApyPct)} />
        </dl>
      </div>
    </>
  );
}

function Legend({ tone, label, value }: { tone: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className={`size-2 rounded-full ${tone}`} />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ws-num font-medium">{value}</dd>
    </div>
  );
}

/** The same asset elsewhere, else the same protocol's other pools: one tap opens that pool. */
function SimilarPools({ pool, onSelect }: { pool: YieldPoolRow; onSelect: (pool: YieldPoolRow) => void }) {
  const others = research.yieldPools.filter((other) => other.id !== pool.id);
  const sameAsset = others.filter((other) => other.symbol === pool.symbol);
  const sameProject = others.filter((other) => other.project === pool.project);
  const [title, candidates] =
    sameAsset.length > 0
      ? [`${pool.symbol} elsewhere`, sameAsset]
      : sameProject.length > 0
        ? [`More from ${projectName(pool.project)}`, sameProject]
        : [`Top pools on ${pool.chain}`, others.filter((other) => other.chain === pool.chain)];
  const list = candidates.sort((a, b) => (b.totalApyPct ?? -1) - (a.totalApyPct ?? -1)).slice(0, 4);
  return (
    <>
      <p className="text-[13px] text-muted-foreground">{title}</p>
      {list.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-muted-foreground">No other pools in the snapshot.</p>
      ) : (
        <ul className="mt-2 -mx-2 flex flex-col">
          {list.map((other) => (
            <li key={other.id}>
              <button
                type="button"
                onClick={() => onSelect(other)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-secondary"
              >
                <LogoPair
                  className="size-7"
                  primary={{ name: projectName(other.project), url: projectLogo(other.project) }}
                  secondary={{ name: other.chain, url: chainLogoUrl(other.chain) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{other.symbol}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {projectName(other.project)} · {other.chain}
                  </span>
                </span>
                <span className="ws-num text-[13.5px] font-medium">{formatApy(other.totalApyPct)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ProtocolPanel({ pool }: { pool: YieldPoolRow }) {
  const protocol = PROTOCOLS.get(pool.project);
  // A pool whose protocol isn't in the snapshot has no protocol figures to show.
  if (!protocol) return null;
  const onChain = protocol.tvlByChainUsd[pool.chain] ?? null;
  return (
    <section className="ws-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <ProtocolLogo name={protocol.name} fallback={protocol.logo} className="size-10" />
          <div>
            <p className="text-[16px] font-medium">{protocol.name}</p>
            <p className="text-[13px] text-muted-foreground">{protocol.category}</p>
          </div>
        </div>
        <ul aria-label={`${protocol.name} is deployed on`} className="flex flex-wrap gap-1.5">
          {protocol.chains.map((chain) => (
            <li
              key={chain}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] ${chain === pool.chain ? 'border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] text-[var(--ws-accent-ink)]' : 'border-border bg-card'}`}
            >
              <ChainLogo chain={chain} className="size-4" /> {chain}
            </li>
          ))}
        </ul>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-5">
        <Kpi label="TVL, all chains" value={formatUsd(protocol.allChainsTvlUsd)} />
        <Kpi label={`TVL on ${pool.chain}`} value={formatUsd(onChain)} />
        <Kpi label="This pool's share" value={protocolShare(pool)} />
        <div className="min-w-0">
          <dt className="text-[12.5px] text-muted-foreground">1d change</dt>
          <dd className="ws-num mt-1 text-[19px] font-medium">
            <Signed value={protocol.change.day} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[12.5px] text-muted-foreground">7d change</dt>
          <dd className="ws-num mt-1 text-[19px] font-medium">
            <Signed value={protocol.change.week} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Signed({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return <span className={value < 0 ? 'text-destructive' : 'text-success'}>{formatPercentPoints(value)}</span>;
}

function protocolShare(pool: YieldPoolRow): string {
  const onChain = PROTOCOLS.get(pool.project)?.tvlByChainUsd[pool.chain];
  if (!onChain || pool.tvlUsd === null) return '—';
  return formatApy(Math.min(100, (pool.tvlUsd / onChain) * 100));
}

function Tokens({ tokens }: { tokens: string[] }) {
  if (tokens.length === 0) return '—';
  return (
    <span className="inline-flex flex-col items-end gap-0.5 font-mono text-[12px]">
      {tokens.slice(0, 3).map((token) => (
        <span key={token} title={token}>
          {token.length > 14 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token}
        </span>
      ))}
      {tokens.length > 3 ? <span className="text-muted-foreground">+{tokens.length - 3} more</span> : null}
    </span>
  );
}

function ExternalButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      nativeButton={false}
      variant="outline"
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
      className="h-10 gap-2 px-4"
    >
      {children} <ExternalLink className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
