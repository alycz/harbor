import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Pause, Play, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { call, execution } from '../lib/execution.ts';
import { formatUtc } from '../lib/format.ts';
import { useWallet } from '../lib/wallet.tsx';
import { Chip, EmptyState, Panel } from './workspace.tsx';

interface Alert {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  revision: number;
  configHash: string;
  lastResult: 'true' | 'false' | 'unknown' | null;
  lastEvaluatedAt: string | null;
  lastAlertAt: string | null;
  unacknowledgedAlerts: number;
}

const SELECT =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

const alerts = {
  list: () => call<{ automations: Alert[] }>('/api/automations'),
  create: (body: unknown) => call<Alert>('/api/automations', { method: 'POST', body }),
  activate: (alert: Alert) =>
    call<Alert>(`/api/automations/${alert.id}/activate`, {
      method: 'POST',
      body: { revision: alert.revision, configHash: alert.configHash },
    }),
  pause: (alert: Alert) => call<Alert>(`/api/automations/${alert.id}/pause`, { method: 'POST', body: {} }),
  remove: (alert: Alert) => call<{ ok: true }>(`/api/automations/${alert.id}`, { method: 'DELETE' }),
};

/**
 * Price alerts: Harbor quotes a swap about once a minute and tells you when it reaches your target. They
 * only read quotes; an alert never trades.
 */
export function PriceAlerts() {
  const id = useId();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const assets = useQuery({ queryKey: ['assets'], queryFn: execution.assets, staleTime: 5 * 60_000 });
  const list = useQuery({
    queryKey: ['alerts', wallet.address],
    queryFn: alerts.list,
    enabled: Boolean(wallet.address),
    refetchInterval: 30_000,
  });
  const [draft, setDraft] = useState({ sell: 'NEAR', amount: '10', buy: 'USDC', target: '40' });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['alerts', wallet.address] });
  const create = useMutation({
    mutationFn: async () => {
      const sell = assets.data?.assets.find((asset) => asset.symbol === draft.sell);
      const buy = assets.data?.assets.find((asset) => asset.symbol === draft.buy);
      if (!sell || !buy) throw new Error('Choose two supported assets.');
      const created = await alerts.create({
        kind: 'price_alert',
        config: {
          sell: { assetId: sell.canonicalId, symbol: sell.symbol, amount: draft.amount },
          buy: { assetId: buy.canonicalId, symbol: buy.symbol },
          minOutput: draft.target,
          cooldownMinutes: 60,
          mode: 'repeat',
        },
      });
      return alerts.activate(created);
    },
    onSuccess: refresh,
  });
  const change = useMutation({
    mutationFn: async ({ action, alert }: { action: 'activate' | 'pause' | 'remove'; alert: Alert }) => {
      await alerts[action](alert);
    },
    onSuccess: refresh,
  });
  const symbols = (assets.data?.assets ?? []).map((asset) => asset.symbol);

  if (!wallet.address) {
    return (
      <Panel label="Price alerts" icon={<Bell />} labelId="price-alerts">
        <EmptyState
          icon={<Bell />}
          title="Connect a wallet to set price alerts"
          description="Harbor checks a live quote about once a minute and tells you when it reaches your target."
        />
      </Panel>
    );
  }
  return (
    <Panel label="Price alerts" icon={<Bell />} labelId="price-alerts" bodyClassName="p-5">
      <div className="grid gap-3 @xl/workspace:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-amount`}>
          When
          <Input
            id={`${id}-amount`}
            className="h-10"
            inputMode="decimal"
            value={draft.amount}
            onChange={(event) => setDraft({ ...draft, amount: event.target.value.trim() })}
          />
        </label>
        <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-sell`}>
          Of
          <select
            id={`${id}-sell`}
            className={SELECT}
            value={draft.sell}
            onChange={(event) => setDraft({ ...draft, sell: event.target.value })}
          >
            {symbols.map((symbol) => (
              <option key={symbol}>{symbol}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-target`}>
          Quotes at least
          <Input
            id={`${id}-target`}
            className="h-10"
            inputMode="decimal"
            value={draft.target}
            onChange={(event) => setDraft({ ...draft, target: event.target.value.trim() })}
          />
        </label>
        <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-buy`}>
          Of
          <select
            id={`${id}-buy`}
            className={SELECT}
            value={draft.buy}
            onChange={(event) => setDraft({ ...draft, buy: event.target.value })}
          >
            {symbols.map((symbol) => (
              <option key={symbol}>{symbol}</option>
            ))}
          </select>
        </label>
        <Button className="mt-auto h-10 gap-2 px-4" disabled={create.isPending} onClick={() => create.mutate()}>
          <Bell /> Alert me
        </Button>
      </div>
      {create.isError ? <p className="mt-2 text-[13px] text-destructive">{create.error.message}</p> : null}
      <ul className="mt-4 divide-y divide-border border-t border-border">
        {(list.data?.automations ?? []).map((alert) => (
          <li key={alert.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13.5px]">
            <span className="min-w-0">
              <span className="font-medium">{alert.name}</span>
              <span className="block text-[12.5px] text-muted-foreground">
                {alert.lastAlertAt
                  ? `Reached ${formatUtc(alert.lastAlertAt)}`
                  : alert.lastEvaluatedAt
                    ? `Checked ${formatUtc(alert.lastEvaluatedAt)}: ${alert.lastResult === 'unknown' ? 'no quote' : 'not yet'}`
                    : 'Not checked yet'}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              {alert.unacknowledgedAlerts > 0 ? (
                <Chip tone="success" dot>
                  {alert.unacknowledgedAlerts} new
                </Chip>
              ) : null}
              <Chip tone={alert.status === 'active' ? 'accent' : 'neutral'}>{alert.status}</Chip>
              {alert.status === 'active' ? (
                <Button
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  aria-label="Pause"
                  onClick={() => change.mutate({ action: 'pause', alert })}
                >
                  <Pause />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  aria-label="Resume"
                  onClick={() => change.mutate({ action: 'activate', alert })}
                >
                  <Play />
                </Button>
              )}
              <Button
                variant="ghost"
                className="h-9 w-9 p-0"
                aria-label="Delete"
                onClick={() => change.mutate({ action: 'remove', alert })}
              >
                <Trash2 />
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-muted-foreground">Alerts only read quotes. They never trade.</p>
    </Panel>
  );
}
