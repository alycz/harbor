import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, Radar, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { PriceAlerts } from '../components/price-alerts.tsx';
import { useCountdown } from '../components/swap-proposal.tsx';
import { Chip, PageHeader, Panel } from '../components/workspace.tsx';
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
const SELECT = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm';

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
  const valid =
    origin &&
    via &&
    origin !== via &&
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) &&
    /[1-9]/.test(amount) &&
    /^\d+$/.test(threshold) &&
    Number(threshold) <= 10000;
  const result = preview.data;
  const freshness = useCountdown(result?.expiresAt ?? undefined);
  function clearResult() {
    preview.reset();
  }
  return (
    <div className="space-y-6 ws-stagger">
      <PageHeader
        title="Automations"
        description="Watch the market. Act on your terms. Monitor Intents quotes and investigate cross-chain routes, without handing over your wallet."
        meta={
          <Chip tone="accent" dot>
            Monitoring only · You sign every trade
          </Chip>
        }
      />
      <div className="grid gap-4 @xl/workspace:grid-cols-3">
        {[
          ['01', 'Choose a route', 'Use verified assets and their exact chain, not ticker guesses.'],
          ['02', 'Observe the quotes', 'Compare a round trip now, or save a recurring price alert below.'],
          [
            '03',
            'Review before acting',
            'A quote signal is not a trade. Open Trade for a fresh owner-signed proposal.',
          ],
        ].map(([step, title, description]) => (
          <section key={step} className="ws-card p-5">
            <span className="font-mono text-xs text-muted-foreground">{step}</span>
            <h2 className="mt-3 font-medium">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          </section>
        ))}
      </div>
      <Panel label="Round-trip scanner" icon={<Radar />} bodyClassName="p-5">
        <p className="mb-5 text-sm text-muted-foreground">
          Compare A → B → A using two sequential, read-only Intents quotes. This is a snapshot, not a continuously
          running arbitrage bot.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !preview.isPending) preview.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid items-end gap-3 @xl/workspace:grid-cols-[1fr_auto_1fr]">
            <label className="space-y-2 text-sm" htmlFor="roundtrip-origin">
              Starting asset
              <select
                id="roundtrip-origin"
                className={SELECT}
                value={origin}
                disabled={preview.isPending}
                onChange={(event) => {
                  setOrigin(event.target.value);
                  clearResult();
                }}
              >
                <option value="">Choose asset and chain</option>
                {options.map((asset) => (
                  <option key={asset.canonicalId} value={asset.canonicalId}>
                    {asset.symbol} · {asset.chain} · {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <ArrowRight className="mb-3 hidden size-5 text-muted-foreground @xl/workspace:block" aria-hidden="true" />
            <label className="space-y-2 text-sm" htmlFor="roundtrip-via">
              Via asset
              <select
                id="roundtrip-via"
                className={SELECT}
                value={via}
                disabled={preview.isPending}
                onChange={(event) => {
                  setVia(event.target.value);
                  clearResult();
                }}
              >
                <option value="">Choose asset and chain</option>
                {options
                  .filter((asset) => asset.canonicalId !== origin)
                  .map((asset) => (
                    <option key={asset.canonicalId} value={asset.canonicalId}>
                      {asset.symbol} · {asset.chain} · {asset.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="grid items-end gap-3 @xl/workspace:grid-cols-[1fr_1fr_auto]">
            <label className="space-y-2 text-sm" htmlFor="roundtrip-amount">
              Starting amount
              <Input
                id="roundtrip-amount"
                value={amount}
                inputMode="decimal"
                disabled={preview.isPending}
                onChange={(event) => {
                  setAmount(event.target.value);
                  clearResult();
                }}
              />
            </label>
            <label className="space-y-2 text-sm" htmlFor="roundtrip-threshold">
              Minimum gross spread (basis points)
              <Input
                id="roundtrip-threshold"
                value={threshold}
                inputMode="numeric"
                disabled={preview.isPending}
                onChange={(event) => {
                  setThreshold(event.target.value);
                  clearResult();
                }}
              />
            </label>
            <Button type="submit" className="h-10 px-5" disabled={!valid || preview.isPending}>
              <RefreshCw className={preview.isPending ? 'animate-spin' : ''} />
              {preview.isPending ? 'Reading quotes…' : 'Scan route'}
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
            <Button nativeButton={false} variant="outline" className="mt-4" render={<Link to="/trade" />}>
              Open Trade for a fresh quote <ArrowRight />
            </Button>
          </section>
        ) : null}
      </Panel>
      <PriceAlerts />
    </div>
  );
}
