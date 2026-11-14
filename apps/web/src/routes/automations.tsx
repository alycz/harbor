import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Radar, RefreshCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { AssetSelect, chainName } from '../components/asset-select.tsx';
import { PriceAlerts } from '../components/price-alerts.tsx';
import { RoundtripMonitor } from '../components/roundtrip-monitor.tsx';
import { SpreadMonitors } from '../components/spread-monitors.tsx';
import { SwapProposalCard, useCountdown } from '../components/swap-proposal.tsx';
import { Chip, PageHeader, Panel } from '../components/workspace.tsx';
import { outboundReviewRequest, roundtripDraftValid } from '../lib/automation-draft.ts';
import { call, execution } from '../lib/execution.ts';
import { formatUtc } from '../lib/format.ts';

type Roundtrip = {
  status: 'opportunity' | 'below_threshold' | 'unknown';
  observedAt: string;
  expiresAt: string | null;
  amountIn: string;
  amountReturned: string | null;
  grossSpreadBps: string | null;
  reason: string;
  legs: { amountIn: string; amountOut: string; minAmountOut: string; venue: string; expiresAt: string }[];
};

/** Read-only quote research; never constructs an executable arbitrage or signs a transaction. */
export function AutomationsPage() {
  const assets = useQuery({ queryKey: ['assets'], queryFn: execution.assets, staleTime: 300_000 });
  const [origin, setOrigin] = useState('');
  const [via, setVia] = useState('');
  const [amount, setAmount] = useState('10');
  const [threshold, setThreshold] = useState('0');
  const preview = useMutation({
    mutationFn: () =>
      call<Roundtrip>('/api/automations/roundtrip-preview', {
        method: 'POST',
        body: { sellAssetId: origin, buyAssetId: via, amount, minSpreadBps: Number(threshold) },
      }),
  });
  const options = assets.data?.assets ?? [];
  const originAsset = options.find((asset) => asset.canonicalId === origin);
  const viaAsset = options.find((asset) => asset.canonicalId === via);
  const valid = roundtripDraftValid(origin, via, amount, threshold);
  const [reviewLocked, setReviewLocked] = useState(false);
  const review = useMutation({ mutationFn: () => execution.createSwap(outboundReviewRequest(origin, via, amount)) });
  const result = preview.data;
  const locked = preview.isPending || review.isPending || reviewLocked || Boolean(review.data);
  const choices = options.map((asset) => ({
    value: asset.canonicalId,
    symbol: asset.symbol,
    detail: chainName(asset.chain),
  }));
  const freshness = useCountdown(result?.expiresAt ?? undefined);
  function clearResult() {
    preview.reset();
    review.reset();
  }
  return (
    <div className="ws-stagger flex flex-col gap-7">
      <PageHeader
        title="Automations"
        description="Harbor watches the market every minute while you're away and keeps the evidence of every check. When something moves, it tells you and queues the trade for you to sign."
      />
      <SpreadMonitors />
      <PriceAlerts />
      <Panel label="Intents round-trip scan" icon={<Radar />} bodyClassName="p-5 @xl/workspace:p-6">
        <p className="mb-5 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
          Quote a round trip on NEAR Intents right now: start with one asset, swap through another and back. Save the
          route below to check it every minute. Nothing here trades.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !preview.isPending) preview.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid items-start gap-3 @xl/workspace:grid-cols-[1fr_auto_1fr]">
            <ScanField id="roundtrip-origin" label="Start with" hint="The asset you begin and end the round trip in.">
              <AssetSelect
                id="roundtrip-origin"
                value={origin}
                disabled={locked}
                choices={choices}
                placeholder="Choose an asset"
                onChange={(next) => {
                  setOrigin(next);
                  clearResult();
                }}
              />
            </ScanField>
            <ArrowRight className="mt-9 hidden size-4 text-muted-foreground @xl/workspace:block" aria-hidden="true" />
            <ScanField id="roundtrip-via" label="Swap through" hint="The asset the round trip passes through.">
              <AssetSelect
                id="roundtrip-via"
                value={via}
                disabled={locked}
                choices={choices.filter((choice) => choice.value !== origin)}
                placeholder="Choose an asset"
                onChange={(next) => {
                  setVia(next);
                  clearResult();
                }}
              />
            </ScanField>
          </div>
          <div className="grid items-start gap-3 @xl/workspace:grid-cols-[1fr_1fr_auto]">
            <ScanField id="roundtrip-amount" label="Amount" hint="How much the round trip starts with.">
              <UnitInput
                id="roundtrip-amount"
                unit={originAsset?.symbol ?? ''}
                value={amount}
                inputMode="decimal"
                disabled={locked}
                onChange={(next) => {
                  setAmount(next);
                  clearResult();
                }}
              />
            </ScanField>
            <ScanField
              id="roundtrip-threshold"
              label="Flag at a gross spread of"
              hint="Before network fees. 100 bps is 1%."
            >
              <UnitInput
                id="roundtrip-threshold"
                unit="bps"
                value={threshold}
                inputMode="numeric"
                disabled={locked}
                onChange={(next) => {
                  setThreshold(next);
                  clearResult();
                }}
              />
            </ScanField>
            <Button
              type="submit"
              className="h-10 px-5 @xl/workspace:mt-[26px]"
              disabled={!valid || preview.isPending || review.isPending || Boolean(review.data)}
            >
              <RefreshCw className={preview.isPending ? 'animate-spin motion-reduce:animate-none' : ''} />
              {preview.isPending ? 'Quoting…' : 'Scan route'}
            </Button>
          </div>
        </form>
        {assets.isError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            Could not load verified assets. Reload this page to retry.
          </p>
        ) : null}
        {preview.isError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {preview.error.message}
          </p>
        ) : null}
        {result ? (
          <section aria-live="polite" className="mt-5 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium">
                {originAsset?.symbol} → {viaAsset?.symbol} → {originAsset?.symbol}
              </h3>
              <Chip tone={result.status === 'opportunity' && freshness !== 0 ? 'accent' : 'neutral'}>
                {freshness === 0
                  ? 'Stale snapshot · scan again'
                  : result.status === 'opportunity'
                    ? 'Gross threshold met'
                    : result.status === 'unknown'
                      ? 'Quote unavailable'
                      : 'Below threshold'}
              </Chip>
            </div>
            <dl className="my-4 grid gap-4 @xl/workspace:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Starting amount</dt>
                <dd className="mt-1 font-mono">{result.amountIn}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Quoted return</dt>
                <dd className="mt-1 font-mono">{result.amountReturned ?? 'Unavailable'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Gross spread / net profit</dt>
                <dd className="mt-1 font-mono">
                  {result.grossSpreadBps === null ? 'Unknown' : `${result.grossSpreadBps} bps`} / Unknown
                </dd>
              </div>
            </dl>
            <p className="text-sm">{result.reason}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Observed {formatUtc(result.observedAt)}
              {result.expiresAt ? ` · Local freshness deadline ${formatUtc(result.expiresAt)}` : ''}. Quotes can expire
              or change. External costs are not included; sequential legs are not atomic and profit is not guaranteed.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              disabled={review.isPending || Boolean(review.data) || result.status === 'unknown' || freshness === 0}
              onClick={() => review.mutate()}
            >
              {review.isPending ? 'Preparing review…' : 'Review outbound swap'} <ArrowRight />
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Only the outbound leg is proposed. Review fresh terms and sign in your own wallet. The return leg is not
              scheduled or executed.
            </p>
          </section>
        ) : null}
        {valid ? (
          <RoundtripMonitor
            key={`${origin}:${via}:${amount}:${threshold}`}
            origin={origin}
            via={via}
            amount={amount}
            threshold={threshold}
          />
        ) : null}
      </Panel>
      {review.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {review.error.message}
        </p>
      ) : null}
      {review.data ? (
        <section className="space-y-3" aria-label="Outbound swap review">
          <SwapProposalCard key={review.data.id} intentId={review.data.id} onInteractionLock={setReviewLocked} />
          <Button variant="outline" disabled={reviewLocked} onClick={() => review.reset()}>
            Close review
          </Button>
        </section>
      ) : null}
    </div>
  );
}

/** A labelled scan setting with a short hint, matching the monitor card above. */
function ScanField({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
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

/** A number input with its unit shown inside, on the right. */
function UnitInput({
  id,
  unit,
  value,
  inputMode,
  disabled,
  onChange,
}: {
  id: string;
  unit: string;
  value: string;
  inputMode: 'decimal' | 'numeric';
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        className="h-10 pr-14"
        value={value}
        inputMode={inputMode}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.trim())}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12.5px] text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </div>
  );
}
