import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Bell, Check, ChevronDown, LoaderCircle, Pause, Play, Radar, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import {
  type Automation,
  type AutomationAlert,
  type AutomationDetail,
  automations,
  type CheckResult,
  formatEdge,
  isSpreadEvidence,
  type RoundTrip,
  routeVenues,
  SPREAD_PAIRS,
  type SpreadCheck,
  type SpreadConfig,
  type SpreadEvidence,
} from '../lib/automations.ts';
import { ExecutionRequestError, execution } from '../lib/execution.ts';
import { formatTokenAmount, formatUtc } from '../lib/format.ts';
import { useWallet } from '../lib/wallet.tsx';
import { SwapProposalCard } from './swap-proposal.tsx';
import { Chip, EmptyState, Panel } from './workspace.tsx';

const SELECT =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
const PREVIEW_REFRESH_MS = 30_000;
const LIST_REFRESH_MS = 30_000;

/**
 * Eyes while you're away: spread monitors Harbor checks every minute on its own, NEAR Intents against
 * Rhea, with the evidence of every check kept and alerts that can queue the NEAR Intents leg for you to
 * review and sign. Nothing here signs for you.
 */
export function SpreadMonitors() {
  return (
    <>
      <ConfigureMonitor />
      <MonitorList />
    </>
  );
}

interface Draft {
  pair: number;
  size: string;
  threshold: string;
  cooldown: string;
  mode: 'once' | 'repeat';
}

/** One labelled field with a short hint under it, the way every setting on this card reads. */
function Field({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      {children}
      <p className="text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * Configure a spread monitor: the settings on the left of the reading, and the market right now under
 * them, so what you set is always measured against what the venues quote.
 */
function ConfigureMonitor() {
  const id = useId();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const assets = useQuery({ queryKey: ['assets'], queryFn: execution.assets, staleTime: 5 * 60_000 });
  const [draft, setDraft] = useState<Draft>({ pair: 0, size: '100', threshold: '0.5', cooldown: '15', mode: 'repeat' });
  const config = spreadConfig(draft, assets.data?.assets ?? []);
  // Typing should not fire a quote per keystroke: read the market once the settings rest.
  const configKey = JSON.stringify(config);
  const [settledKey, setSettledKey] = useState(configKey);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(configKey), 600);
    return () => clearTimeout(timer);
  }, [configKey]);
  const settled = JSON.parse(settledKey) as SpreadConfig | null;
  const live = useQuery({
    queryKey: ['spread-preview', settledKey],
    queryFn: () => automations.previewSpread(settled as SpreadConfig),
    enabled: settled !== null,
    refetchInterval: PREVIEW_REFRESH_MS,
    retry: false,
  });
  const start = useMutation({
    mutationFn: async () => {
      if (!config) throw new Error('Check the monitor settings.');
      const created = await automations.create('spread_alert', config);
      return automations.activate(created);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations', wallet.address] }),
  });
  const pair = SPREAD_PAIRS[draft.pair] ?? SPREAD_PAIRS[0];
  const set = (patch: Partial<Draft>) => {
    start.reset();
    setDraft((current) => ({ ...current, ...patch }));
  };

  return (
    <section aria-labelledby={`${id}-title`} className="ws-card overflow-hidden">
      <header className="border-b border-border px-5 py-4 @xl/workspace:px-6">
        <h2 id={`${id}-title`} className="font-display text-[24px] leading-tight">
          Configure your monitor
        </h2>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Harbor quotes a round trip on NEAR Intents and Rhea every minute and alerts you when the gap pays.
        </p>
      </header>
      <div className="space-y-5 px-5 py-5 @xl/workspace:px-6">
        <div className="grid gap-x-5 gap-y-4 @2xl/workspace:grid-cols-2">
          <Field id={`${id}-pair`} label="Pair" hint={`Priced on NEAR Intents and on Rhea, both on NEAR.`}>
            <select
              id={`${id}-pair`}
              className={SELECT}
              value={draft.pair}
              onChange={(event) => set({ pair: Number(event.target.value) })}
            >
              {SPREAD_PAIRS.map((option, index) => (
                <option key={`${option.base}/${option.quote}`} value={index}>
                  {option.base} / {option.quote}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-size`} label={`Trade size (${pair.quote})`} hint="The round trip the gap is measured on.">
            <Input
              id={`${id}-size`}
              className="h-10"
              inputMode="decimal"
              value={draft.size}
              onChange={(event) => set({ size: event.target.value.trim() })}
            />
          </Field>
          <Field
            id={`${id}-threshold`}
            label="Alert at profit of (%)"
            hint="After both venues’ fees and price impact. Below zero alerts when the round trip costs less than that."
          >
            <Input
              id={`${id}-threshold`}
              className="h-10"
              inputMode="decimal"
              value={draft.threshold}
              onChange={(event) => set({ threshold: event.target.value.trim() })}
            />
          </Field>
          <Field id={`${id}-cooldown`} label="Cooldown (minutes)" hint="Minimum time between alerts.">
            <Input
              id={`${id}-cooldown`}
              className="h-10"
              inputMode="numeric"
              value={draft.cooldown}
              onChange={(event) => set({ cooldown: event.target.value.trim() })}
            />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Repeat</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['repeat', 'Every time the gap reopens'],
                ['once', 'Once, then stop'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={draft.mode === value}
                onClick={() => set({ mode: value })}
                className={`h-9 rounded-md border px-3.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  draft.mode === value
                    ? 'border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] text-[var(--ws-accent-ink)]'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {config === null ? (
          <p role="alert" className="text-[12.5px] text-destructive">
            Enter a size above zero, a profit from −5% to 50%, and a cooldown of 1 to 1,440 minutes.
          </p>
        ) : null}
        <LiveNow
          config={settled}
          pending={live.isPending && settled !== null}
          error={live.error}
          reading={live.data ?? null}
        />
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4 @xl/workspace:px-6">
        {wallet.address ? (
          <Button
            className="h-10 gap-2 px-4"
            disabled={config === null || start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
            Start monitoring
          </Button>
        ) : (
          <Button className="h-10 px-4" onClick={wallet.connect} disabled={wallet.connecting}>
            Connect wallet to start
          </Button>
        )}
        {start.isSuccess ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-success">
            <Check className="size-4" aria-hidden="true" /> Monitoring. The first check runs within a minute.
          </span>
        ) : null}
        {start.error ? <span className="text-[13px] text-destructive">{errorText(start.error)}</span> : null}
        <Link
          to="/chat"
          search={{
            ask: `Explain the ${pair.base}/${pair.quote} price gap between NEAR Intents and Rhea right now, and whether a ${draft.size} ${pair.quote} round trip is worth it.`,
          }}
          className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ws-accent-ink)] hover:underline"
        >
          Ask Harbor <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </footer>
    </section>
  );
}

/** What each venue quotes right now for the configured size, the gap between them and the better route. */
function LiveNow({
  config,
  pending,
  error,
  reading,
}: {
  config: SpreadConfig | null;
  pending: boolean;
  error: unknown;
  reading: SpreadCheck | null;
}) {
  const box = 'rounded-xl border border-border bg-secondary/35 p-4 @xl/workspace:p-5';
  if (config === null)
    return <div className={`${box} text-[13px] text-muted-foreground`}>Fix the settings to read the market.</div>;
  if (pending) {
    return (
      <div role="status" className={`${box} flex items-center gap-2 text-[13px] text-muted-foreground`}>
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Quoting NEAR Intents and Rhea…
      </div>
    );
  }
  if (error || !reading) return <div className={`${box} text-[13px] text-destructive`}>{errorText(error)}</div>;
  const { evidence } = reading;
  const prices = venuePrices(evidence);
  const best = evidence.trips.find((trip) => trip.route === evidence.best) ?? null;
  const returned = best?.returned ?? null;
  const delta = returned === null ? null : Number(returned) - Number(evidence.size.amount);
  const [buyOn, sellOn] = best ? routeVenues(best.route) : ['', ''];
  const status =
    reading.result === 'true'
      ? 'Above threshold'
      : reading.result === 'unknown'
        ? 'Could not price'
        : 'Below threshold';
  return (
    <section aria-live="polite" aria-label="Live market" className={box}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" />
          Live now, {formatClock(reading.evaluatedAt)}
        </span>
        <Chip tone={reading.result === 'true' ? 'success' : reading.result === 'unknown' ? 'warning' : 'neutral'}>
          {status}
        </Chip>
      </div>
      <div className="mt-4 grid gap-4 @xl/workspace:grid-cols-2">
        {prices.map((venue) => (
          <div key={venue.name}>
            <p className="text-[13px] text-muted-foreground">{venue.name}</p>
            <p className="ws-num mt-1 text-[26px] leading-none font-medium tracking-[-0.02em]">
              {venue.price === null ? '—' : formatPrice(venue.price)}
            </p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {config.quote.symbol} per {config.base.symbol}, buying with {formatTokenAmount(config.size)}{' '}
              {config.quote.symbol}, fees included
            </p>
          </div>
        ))}
      </div>
      <dl className="mt-5 space-y-2 border-t border-border pt-4 text-[13.5px]">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Price gap</dt>
          <dd className="ws-num">{priceGap(prices)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">
            Round trip on {formatTokenAmount(config.size)} {config.quote.symbol}
          </dt>
          <dd className={`ws-num ${delta !== null && delta >= 0 ? 'text-success' : ''}`}>
            {best
              ? `${formatEdge(best.edgePct)} (${delta !== null && delta >= 0 ? '+' : '−'}${Math.abs(delta ?? 0).toFixed(2)} ${config.quote.symbol})`
              : '—'}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Route</dt>
          <dd className="text-right">{best ? `Buy on ${buyOn}, sell on ${sellOn}` : '—'}</dd>
        </div>
      </dl>
      <p className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground">{reading.reason}</p>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        Venue fees and price impact are included; network fees are not. Harbor executes the NEAR Intents leg; Rhea is
        priced for comparison.
      </p>
    </section>
  );
}

/** Each venue's effective price for buying the base with the configured size: size ÷ base received. */
function venuePrices(evidence: SpreadEvidence): Array<{ name: string; price: number | null }> {
  const firstLegPrice = (route: RoundTrip['route']) => {
    const leg = evidence.trips.find((trip) => trip.route === route)?.legs[0];
    const received = leg ? Number(leg.buy.amount) : 0;
    return received > 0 ? Number(evidence.size.amount) / received : null;
  };
  return [
    { name: 'NEAR Intents', price: firstLegPrice('intents_then_rhea') },
    { name: 'Rhea', price: firstLegPrice('rhea_then_intents') },
  ];
}

function priceGap(prices: Array<{ price: number | null }>): string {
  const [a, b] = prices.map((entry) => entry.price);
  if (!a || !b) return '—';
  return `${((Math.abs(a - b) / Math.min(a, b)) * 100).toFixed(2)}%`;
}

function formatPrice(price: number): string {
  return price >= 1 ? price.toFixed(4) : price.toPrecision(4);
}

function formatClock(iso: string): string {
  return `${new Date(iso).toISOString().slice(11, 19)} UTC`;
}

function MonitorList() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['automations', wallet.address],
    queryFn: automations.list,
    enabled: Boolean(wallet.address),
    refetchInterval: LIST_REFRESH_MS,
  });
  const [open, setOpen] = useState<string | null>(null);
  const spread = (list.data?.automations ?? []).filter((rule) => rule.kind === 'spread_alert');
  const change = useMutation({
    mutationFn: async ({ action, rule }: { action: 'resume' | 'pause' | 'remove'; rule: Automation }) => {
      if (action === 'pause') return automations.pause(rule.id);
      if (action === 'remove') return automations.remove(rule.id);
      return automations.activate(rule);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automations', wallet.address] }),
  });

  return (
    <Panel label="Your spread monitors" icon={<Bell />} labelId="automations-list" bodyClassName="">
      {!wallet.address ? (
        <EmptyState
          icon={<Radar />}
          title="Connect your wallet to see your spread monitors"
          description="Monitors belong to the account that made them. The live check above works without one."
        />
      ) : list.isPending ? (
        <p role="status" className="p-5 text-[13px] text-muted-foreground">
          Loading your monitors…
        </p>
      ) : list.error ? (
        <p className="p-5 text-[13px] text-destructive">{errorText(list.error)}</p>
      ) : spread.length === 0 ? (
        <EmptyState
          icon={<Radar />}
          title="No spread monitors yet"
          description="Start one above. Harbor checks it every minute and keeps the evidence of every check."
        />
      ) : (
        <ul>
          {spread.map((rule) => (
            <li key={rule.id} className="border-b border-border last:border-b-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={open === rule.id}
                  onClick={() => setOpen(open === rule.id ? null : rule.id)}
                >
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${open === rule.id ? '' : '-rotate-90'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{rule.name}</span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {rule.lastEvaluatedAt ? `Checked ${formatUtc(rule.lastEvaluatedAt)}` : 'Not checked yet'}
                      {rule.lastAlertAt ? `, alerted ${formatUtc(rule.lastAlertAt)}` : ''}
                    </span>
                  </span>
                </button>
                {rule.unacknowledgedAlerts ? <Chip tone="accent">{rule.unacknowledgedAlerts} new</Chip> : null}
                <StatusChip rule={rule} />
                <div className="flex gap-1.5">
                  {rule.status === 'active' ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Pause ${rule.name}`}
                      disabled={change.isPending}
                      onClick={() => change.mutate({ action: 'pause', rule })}
                    >
                      <Pause />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Start ${rule.name}`}
                      disabled={change.isPending}
                      onClick={() => change.mutate({ action: 'resume', rule })}
                    >
                      <Play />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${rule.name}`}
                    disabled={change.isPending}
                    onClick={() => change.mutate({ action: 'remove', rule })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              {open === rule.id ? <MonitorDetail id={rule.id} /> : null}
            </li>
          ))}
        </ul>
      )}
      {change.error ? <p className="px-5 pb-4 text-[13px] text-destructive">{errorText(change.error)}</p> : null}
    </Panel>
  );
}

function StatusChip({ rule }: { rule: Automation }) {
  if (rule.status === 'active' && !rule.armed) {
    return (
      <Chip tone="accent" dot>
        Alerted, re-arms when the gap closes
      </Chip>
    );
  }
  if (rule.status === 'active') {
    return (
      <Chip tone={rule.lastResult === 'unknown' ? 'warning' : 'success'} dot>
        {rule.lastResult === 'unknown' ? 'Watching, last check unpriced' : 'Watching'}
      </Chip>
    );
  }
  return (
    <Chip tone="neutral">{rule.status === 'completed' ? 'Done' : rule.status === 'paused' ? 'Paused' : 'Draft'}</Chip>
  );
}

/** A monitor's alerts, each able to queue its trade, and the evidence of its recent checks. */
function MonitorDetail({ id }: { id: string }) {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['automation', id],
    queryFn: () => automations.read(id),
    refetchInterval: LIST_REFRESH_MS,
  });
  const acknowledge = useMutation({
    mutationFn: automations.acknowledge,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['automation', id] });
      void queryClient.invalidateQueries({ queryKey: ['automations', wallet.address] });
    },
  });
  if (detail.isPending) {
    return (
      <p role="status" className="px-5 pb-4 text-[13px] text-muted-foreground">
        Loading checks…
      </p>
    );
  }
  if (detail.error || !detail.data) {
    return <p className="px-5 pb-4 text-[13px] text-destructive">{errorText(detail.error)}</p>;
  }
  const rule = detail.data;
  return (
    <div className="space-y-5 border-t border-border bg-secondary/20 px-5 py-4">
      <section aria-label="Alerts" className="space-y-2.5">
        <h3 className="text-[13px] font-medium">Alerts</h3>
        {rule.alerts.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No alerts yet. Every check is recorded below.</p>
        ) : (
          <ul className="space-y-2.5">
            {rule.alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                rule={rule}
                acknowledging={acknowledge.isPending}
                onAcknowledge={() => acknowledge.mutate(alert.id)}
              />
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Recent checks" className="space-y-2.5">
        <h3 className="text-[13px] font-medium">Recent checks</h3>
        {rule.evaluations.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">The first check runs within a minute of starting.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-[12.5px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-4 font-normal">Checked</th>
                  <th className="py-1.5 pr-4 font-normal">Result</th>
                  <th className="py-1.5 pr-4 font-normal">Best route</th>
                  <th className="py-1.5 font-normal">What Harbor saw</th>
                </tr>
              </thead>
              <tbody>
                {rule.evaluations.map((evaluation) => {
                  const best = bestTrip(evaluation.evidence);
                  return (
                    <tr key={evaluation.id} className="border-t border-border/70 align-top">
                      <td className="ws-num py-2 pr-4 whitespace-nowrap">{formatUtc(evaluation.evaluatedAt)}</td>
                      <td className="py-2 pr-4">
                        <ResultChip result={evaluation.result} triggered={evaluation.triggered} />
                      </td>
                      <td className="ws-num py-2 pr-4 whitespace-nowrap">{best ? formatEdge(best.edgePct) : '—'}</td>
                      <td className="py-2 text-muted-foreground">{evaluation.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function AlertRow({
  alert,
  rule,
  acknowledging,
  onAcknowledge,
}: {
  alert: AutomationAlert;
  rule: AutomationDetail;
  acknowledging: boolean;
  onAcknowledge: () => void;
}) {
  const evaluation = rule.evaluations.find((entry) => entry.id === alert.evaluationId);
  const trip = rule.kind === 'spread_alert' ? bestTrip(evaluation?.evidence) : null;
  return (
    <li className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-muted-foreground">{formatUtc(alert.createdAt)}</p>
          <p className="mt-1 text-[13px] leading-relaxed">{alert.summary}</p>
        </div>
        {alert.acknowledgedAt ? (
          <Chip tone="neutral">Seen</Chip>
        ) : (
          <Button variant="ghost" className="h-8 px-2.5 text-[12.5px]" disabled={acknowledging} onClick={onAcknowledge}>
            Mark seen
          </Button>
        )}
      </div>
      {trip ? <QueueIntentsLeg trip={trip} /> : null}
    </li>
  );
}

/**
 * Queues the NEAR Intents leg of an alert's round trip as an ordinary swap: you review the live quote,
 * your policy is checked, and you sign it. The Rhea leg is yours to do on Rhea.
 */
function QueueIntentsLeg({ trip }: { trip: RoundTrip }) {
  const wallet = useWallet();
  const [intentId, setIntentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leg = trip.legs.find((entry) => entry.venue === 'NEAR Intents');
  if (!leg) return null;
  const intentsFirst = trip.route === 'intents_then_rhea';

  async function queue() {
    if (!leg) return;
    setBusy(true);
    setError(null);
    try {
      const intent = await execution.createSwap({
        sellAsset: leg.sell.symbol,
        buyAsset: leg.buy.symbol,
        sellAmount: leg.sell.amount,
      });
      setIntentId(intent.id);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {intentId ? (
        <SwapProposalCard intentId={intentId} />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {wallet.address ? (
            <Button className="h-9 gap-2 px-3.5 text-[13px]" disabled={busy} onClick={queue}>
              {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
              Queue the NEAR Intents leg: {formatTokenAmount(leg.sell.amount)} {leg.sell.symbol} → {leg.buy.symbol}
            </Button>
          ) : (
            <Button className="h-9 px-3.5 text-[13px]" onClick={wallet.connect} disabled={wallet.connecting}>
              Connect wallet to queue
            </Button>
          )}
          <span className="text-[12px] text-muted-foreground">
            {intentsFirst
              ? 'Then sell on Rhea to close the round trip. You review a fresh quote before signing.'
              : 'Buy on Rhea first; this sells it back through NEAR Intents. You review a fresh quote before signing.'}
          </span>
        </div>
      )}
      {error ? <p className="mt-2 text-[12.5px] text-destructive">{error}</p> : null}
    </div>
  );
}

function ResultChip({ result, triggered }: { result: CheckResult; triggered: boolean }) {
  if (triggered) return <Chip tone="accent">Alerted</Chip>;
  if (result === 'true') return <Chip tone="success">Above</Chip>;
  if (result === 'unknown') return <Chip tone="warning">Unpriced</Chip>;
  return <Chip tone="neutral">Below</Chip>;
}

function bestTrip(evidence: unknown): RoundTrip | null {
  if (!isSpreadEvidence(evidence) || !evidence.best) return null;
  return evidence.trips.find((trip) => trip.route === evidence.best) ?? null;
}

/** The monitor config the form describes, or null while it is not valid. */
function spreadConfig(draft: Draft, assets: readonly { symbol: string; canonicalId: string }[]): SpreadConfig | null {
  const pair = SPREAD_PAIRS[draft.pair];
  const base = assets.find((asset) => asset.symbol === pair?.base);
  const quote = assets.find((asset) => asset.symbol === pair?.quote);
  const threshold = Number(draft.threshold);
  const cooldown = Number(draft.cooldown);
  if (!pair || !base || !quote) return null;
  if (!/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/.test(draft.size) || Number(draft.size) <= 0) return null;
  if (draft.threshold === '' || !Number.isFinite(threshold) || threshold < -5 || threshold > 50) return null;
  if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 1_440) return null;
  return {
    base: { assetId: base.canonicalId, symbol: base.symbol },
    quote: { assetId: quote.canonicalId, symbol: quote.symbol },
    size: draft.size,
    thresholdPct: threshold,
    cooldownMinutes: cooldown,
    mode: draft.mode,
  };
}

function errorText(error: unknown): string {
  if (error instanceof ExecutionRequestError || error instanceof Error) return error.message;
  return 'Something went wrong. Try again.';
}
