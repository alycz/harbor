import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../lib/execution.ts';
import { useWallet } from '../lib/wallet.tsx';

interface SavedMonitor {
  id: string;
  revision: number;
  configHash: string;
  status: string;
}

/** Creating a monitor never grants execution permission. Activation binds the saved revision. */
export function RoundtripMonitor({
  origin,
  via,
  amount,
  threshold,
}: {
  origin: string;
  via: string;
  amount: string;
  threshold: string;
}) {
  const wallet = useWallet();
  const client = useQueryClient();
  const [cooldown, setCooldown] = useState('60');
  const [mode, setMode] = useState<'once' | 'repeat'>('repeat');
  const [name, setName] = useState('Intents round-trip monitor');
  const create = useMutation({
    mutationFn: () =>
      call<SavedMonitor>('/api/automations', {
        method: 'POST',
        body: {
          kind: 'roundtrip_alert',
          name,
          config: {
            sellAssetId: origin,
            buyAssetId: via,
            amount,
            minSpreadBps: Number(threshold),
            cooldownMinutes: Number(cooldown),
            mode,
          },
        },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['alerts', wallet.address] }),
  });
  const activate = useMutation({
    mutationFn: () => {
      const saved = create.data;
      if (!saved) throw new Error('Save the monitor first.');
      return call<SavedMonitor>(`/api/automations/${saved.id}/activate`, {
        method: 'POST',
        body: { revision: saved.revision, configHash: saved.configHash },
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['alerts', wallet.address] }),
  });
  const locked = create.isPending || Boolean(create.data);
  if (!wallet.address)
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Connect your wallet to save this route as a scheduled monitor. Quote scanning does not require a wallet.
      </p>
    );
  return (
    <section className="mt-5 space-y-3 border-t border-border pt-4" aria-label="Save scheduled round-trip monitor">
      <h3 className="font-medium">Keep watching this route</h3>
      <p className="text-xs text-muted-foreground">
        Scheduled checks approximately every minute. Alerts appear here, not by email. No trades are executed. External
        costs are excluded from the gross-spread threshold.
      </p>
      <div className="grid gap-3 @xl/workspace:grid-cols-3">
        <label className="text-sm" htmlFor="monitor-name">
          Name
          <Input
            id="monitor-name"
            maxLength={80}
            value={name}
            disabled={locked}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="text-sm" htmlFor="monitor-cooldown">
          Alert cooldown (minutes)
          <Input
            id="monitor-cooldown"
            value={cooldown}
            inputMode="numeric"
            disabled={locked}
            onChange={(event) => setCooldown(event.target.value)}
          />
        </label>
        <label className="text-sm" htmlFor="monitor-mode">
          After a signal
          <select
            id="monitor-mode"
            className="h-10 w-full rounded-md border border-input bg-background px-3"
            value={mode}
            disabled={locked}
            onChange={(event) => setMode(event.target.value as 'once' | 'repeat')}
          >
            <option value="repeat">Repeat after condition resets</option>
            <option value="once">Stop after first alert</option>
          </select>
        </label>
      </div>
      {!create.data ? (
        <Button
          variant="outline"
          disabled={
            create.isPending ||
            !/^\d+$/.test(cooldown) ||
            Number(cooldown) < 1 ||
            Number(cooldown) > 1440 ||
            !name.trim()
          }
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Saving…' : 'Save monitor draft'}
        </Button>
      ) : activate.isSuccess ? (
        <p role="status" className="text-sm">
          Monitor active. View scheduled checks and signals in Scheduled monitors below.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">
            Draft saved: {amount} starting units · minimum {threshold} bps gross spread · {cooldown}-minute alert
            cooldown · {mode === 'once' ? 'one signal' : 'repeat after reset'}. Activate this exact configuration?
          </p>
          <Button disabled={activate.isPending} onClick={() => activate.mutate()}>
            {activate.isPending ? 'Activating…' : 'Activate monitor'}
          </Button>
        </div>
      )}
      {create.isError ? (
        <p role="alert" className="text-destructive">
          {create.error.message}
        </p>
      ) : null}
      {activate.isError ? (
        <p role="alert" className="text-destructive">
          {activate.error.message}
        </p>
      ) : null}
    </section>
  );
}
