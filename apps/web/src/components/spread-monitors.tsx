import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bell, Check, ChevronDown, LoaderCircle, Pause, Play, Radar, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
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
  type SpreadConfig,
  type SpreadEvidence,
} from '../lib/automations.ts';
import { ExecutionRequestError, execution } from '../lib/execution.ts';
import { formatTokenAmount, formatUtc } from '../lib/format.ts';
import { useWallet } from '../lib/wallet.tsx';
import { SwapProposalCard } from './swap-proposal.tsx';
import { Chip, type ChipTone, EmptyState, Panel } from './workspace.tsx';

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
      <NewSpreadMonitor />
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

function NewSpreadMonitor() {
  const id = useId();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const assets = useQuery({ queryKey: ['assets'], queryFn: execution.assets, staleTime: 5 * 60_000 });
  const [draft, setDraft] = useState<Draft>({ pair: 0, size: '100', threshold: '0.5', cooldown: '15', mode: 'repeat' });
  const config = spreadConfig(draft, assets.data?.assets ?? []);
  // Typing should not fire a quote per keystroke: preview the settings once they rest.
  const configKey = JSON.stringify(config);
  const [settledKey, setSettledKey] = useState(configKey);
  useEffect(() => {
    const timer = setTimeout(() => setSettledKey(configKey), 600);
    return () => clearTimeout(timer);
  }, [configKey]);
  const settled = JSON.parse(settledKey) as SpreadConfig | null;
  const preview = useQuery({
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
    <div className="grid items-start gap-5 @4xl/workspace:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Panel label="New spread monitor" icon={<Radar />} labelId={`${id}-title`} bodyClassName="p-5">
        <p className="mb-5 text-[13px] leading-relaxed text-muted-foreground">
          Every minute, Harbor prices a round trip on both venues with real quotes: buy on NEAR Intents and sell on
          Rhea, and the reverse. When the better one clears your threshold, it alerts you and can queue the NEAR Intents
          leg for you to sign.
        </p>
        <div className="grid gap-4 @xl/workspace:grid-cols-2">
          <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-pair`}>
            Pair
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
          </label>
          <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-size`}>
            Trade size ({pair.quote})
            <Input
              id={`${id}-size`}
              className="h-10"
              inputMode="decimal"
              value={draft.size}
              onChange={(event) => set({ size: event.target.value.trim() })}
            />
          </label>
          <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-threshold`}>
            Alert at a round-trip gain of (%)
            <Input
              id={`${id}-threshold`}
              className="h-10"
              inputMode="decimal"
              value={draft.threshold}
              onChange={(event) => set({ threshold: event.target.value.trim() })}
            />
          </label>
          <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-cooldown`}>
            Quiet time after an alert (minutes)
            <Input
              id={`${id}-cooldown`}
              className="h-10"
              inputMode="numeric"
              value={draft.cooldown}
              onChange={(event) => set({ cooldown: event.target.value.trim() })}
            />
          </label>
        </div>
        <fieldset className="mt-4">
          <legend className="mb-1.5 text-[12.5px] text-muted-foreground">Repeat</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['repeat', 'Every time the gap reopens'],
                ['once', 'Once, then stop'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={draft.mode === value ? 'secondary' : 'ghost'}
                aria-pressed={draft.mode === value}
                className="h-9 px-3 text-[13px]"
                onClick={() => set({ mode: value })}
              >
                {label}
              </Button>
            ))}
          </div>
        </fieldset>
        {config === null ? (
          <p className="mt-4 text-[12.5px] text-destructive">
            Enter a size above zero, a threshold from 0% to 50%, and a quiet time of 1 to 1,440 minutes.
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {wallet.address ? (
            <Button
              className="h-10 gap-2 px-4"
              disabled={config === null || start.isPending}
              onClick={() => start.mutate()}
            >
              {start.isPending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Play />}
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
        </div>
      </Panel>
      <Panel
        label="Live check"
        labelId={`${id}-live`}
        aside={preview.data ? `Checked ${formatUtc(preview.data.evaluatedAt)}` : null}
        bodyClassName="p-5"
      >
        {settled === null ? (
          <p className="text-[13px] text-muted-foreground">Fix the settings to see a live check.</p>
        ) : preview.isPending ? (
          <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Quoting both venues…
          </p>
        ) : preview.error ? (
          <p className="text-[13px] text-destructive">{errorText(preview.error)}</p>
        ) : preview.data ? (
          <SpreadReading evidence={preview.data.evidence} result={preview.data.result} />
        ) : null}
      </Panel>
    </div>
  );
}

/** Both round trips of one check, the better one marked, against the threshold. */
function SpreadReading({ evidence, result }: { evidence: SpreadEvidence; result: CheckResult }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={result === 'true' ? 'success' : result === 'unknown' ? 'warning' : 'neutral'} dot>
          {result === 'true' ? 'Would alert now' : result === 'unknown' ? 'Could not price' : 'Below threshold'}
        </Chip>
        <span className="text-[12.5px] text-muted-foreground">
          Alerts at {formatEdge(evidence.thresholdPct)} on {formatTokenAmount(evidence.size.amount)}{' '}
          {evidence.size.symbol}
        </span>
      </div>
      <ul className="space-y-3">
        {evidence.trips.map((trip) => (
          <TripRow key={trip.route} trip={trip} best={trip.route === evidence.best} />
        ))}
      </ul>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Real quotes from both venues, each leg feeding the next. Venue fees and price impact are included; network gas
        is not. Rhea is a price reference: Harbor executes only the NEAR Intents leg.
      </p>
    </div>
  );
}

function TripRow({ trip, best }: { trip: RoundTrip; best: boolean }) {
  const [buyOn, sellOn] = routeVenues(trip.route);
  const tone: ChipTone = trip.edgePct === null ? 'warning' : trip.edgePct >= 0 ? 'success' : 'neutral';
  return (
    <li className={`rounded-lg border p-3.5 ${best ? 'border-border-strong bg-secondary/40' : 'border-border'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] font-medium">
          Buy on {buyOn}, sell on {sellOn}
          {best ? <span className="ml-2 text-[12px] font-normal text-muted-foreground">better route</span> : null}
        </p>
        <Chip tone={tone}>{formatEdge(trip.edgePct)}</Chip>
      </div>
      <ol className="mt-2.5 space-y-1 text-[12.5px] text-muted-foreground">
        {trip.legs.map((leg) => (
          <li key={`${leg.venue}-${leg.sell.symbol}`} className="ws-num flex flex-wrap items-center gap-x-1.5">
            {formatTokenAmount(leg.sell.amount)} {leg.sell.symbol}
            <ArrowRight className="size-3" aria-hidden="true" />
            <span className="text-foreground">
              {formatTokenAmount(leg.buy.amount)} {leg.buy.symbol}
            </span>
            <span>on {leg.venue}</span>
          </li>
        ))}
      </ol>
      {trip.error ? <p className="mt-2 text-[12.5px] text-warning">{trip.error}</p> : null}
    </li>
  );
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
                      {rule.kind === 'spread_alert' ? 'Spread monitor' : 'Price alert'} ·{' '}
                      {rule.lastEvaluatedAt ? `last check ${formatUtc(rule.lastEvaluatedAt)}` : 'not checked yet'}
                      {rule.lastAlertAt ? ` · last alert ${formatUtc(rule.lastAlertAt)}` : ''}
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
  if (rule.status === 'active') {
    return (
      <Chip tone={rule.lastResult === 'unknown' ? 'warning' : 'success'} dot>
        {rule.lastResult === 'unknown' ? 'Watching · last check unpriced' : 'Watching'}
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
  if (draft.threshold === '' || !Number.isFinite(threshold) || threshold < 0 || threshold > 50) return null;
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
