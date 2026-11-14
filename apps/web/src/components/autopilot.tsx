import { Button } from '@harbor/ui/components/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { toast } from 'sonner';

import { autopilot } from '../lib/autopilot.ts';
import { execution } from '../lib/execution.ts';
import { formatUtc } from '../lib/format.ts';
import { useWallet } from '../lib/wallet.tsx';
import { AssetSelect, chainName } from './asset-select.tsx';
import { SwapProposalCard } from './swap-proposal.tsx';
import { UnitInput } from './unit-input.tsx';
import { Chip, EmptyState, Panel } from './workspace.tsx';

/**
 * The recurring actions the owner asked the agent to take. Each one only runs under the owner's active
 * signed policy, and everything it queues still passes that policy.
 */
export function StrategiesPanel() {
  const id = useId();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const assets = useQuery({ queryKey: ['assets'], queryFn: execution.assets, staleTime: 5 * 60_000 });
  const strategies = useQuery({
    queryKey: ['strategies', wallet.address],
    queryFn: autopilot.strategies,
    enabled: Boolean(wallet.address),
  });
  const [draft, setDraft] = useState({ sell: 'NEAR', buy: 'USDC', amount: '0.5', everyHours: '24' });
  const set = (data: Awaited<ReturnType<typeof autopilot.strategies>>) =>
    queryClient.setQueryData(['strategies', wallet.address], data);
  const create = useMutation({
    mutationFn: () => autopilot.create({ ...draft, everyHours: Number(draft.everyHours) }),
    onSuccess: (data) => {
      set(data);
      toast.success('Added', {
        description: `The agent will buy ${draft.buy} with ${draft.amount} ${draft.sell} every ${draft.everyHours} hours.`,
      });
    },
  });
  const change = useMutation({
    mutationFn: ({ action, strategyId }: { action: 'pause' | 'resume' | 'remove'; strategyId: string }) =>
      autopilot[action](strategyId),
    onSuccess: (data, { action }) => {
      set(data);
      if (action === 'remove') toast('Removed. The agent will not run it again.');
    },
  });
  const all = assets.data?.assets ?? [];
  const sellable = all.filter((asset) => asset.chain === 'near');
  const list = strategies.data?.strategies ?? [];
  const hours = Number(draft.everyHours);
  const ready = Number(draft.amount) > 0 && Number.isInteger(hours) && hours >= 1 && draft.buy !== draft.sell;

  return (
    <Panel
      label="What the agent does on its own"
      icon={<Bot />}
      labelId="strategies"
      bodyClassName="p-5 @xl/workspace:p-6"
    >
      <div className="@container">
        <div className="grid gap-3.5 @md:grid-cols-2 @3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.7fr)_auto]">
          <FormField id={`${id}-amount`} label="Spend">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <UnitInput
                  id={`${id}-amount`}
                  unit=""
                  value={draft.amount}
                  inputMode="decimal"
                  onChange={(amount) => setDraft({ ...draft, amount })}
                />
              </div>
              <div className="w-[8.25rem] shrink-0">
                <AssetSelect
                  label="Asset the agent spends"
                  value={draft.sell}
                  choices={sellable.map((asset) => ({ value: asset.symbol, symbol: asset.symbol, detail: '' }))}
                  onChange={(sell) =>
                    setDraft({
                      ...draft,
                      sell,
                      buy: draft.buy === sell ? (all.find((asset) => asset.symbol !== sell)?.symbol ?? '') : draft.buy,
                    })
                  }
                />
              </div>
            </div>
          </FormField>
          <FormField id={`${id}-buy`} label="To buy">
            <AssetSelect
              id={`${id}-buy`}
              value={draft.buy}
              choices={all
                .filter((asset) => asset.symbol !== draft.sell)
                .map((asset) => ({ value: asset.symbol, symbol: asset.symbol, detail: chainName(asset.chain) }))}
              onChange={(buy) => setDraft({ ...draft, buy })}
            />
          </FormField>
          <FormField id={`${id}-every`} label="Every">
            <UnitInput
              id={`${id}-every`}
              unit="hours"
              value={draft.everyHours}
              inputMode="numeric"
              onChange={(everyHours) => setDraft({ ...draft, everyHours })}
            />
          </FormField>
          <Button
            className="h-10 gap-2 self-end px-4"
            disabled={create.isPending || !ready}
            onClick={() => create.mutate()}
          >
            <Plus /> Add
          </Button>
        </div>
      </div>
      {create.isError ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {create.error.message}
        </p>
      ) : null}
      {list.length > 0 ? (
        <ul className="mt-5 divide-y divide-border border-t border-border">
          {list.map((strategy) => (
            <li key={strategy.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13.5px]">
              <span className="min-w-0">
                <span className="font-medium">
                  Buy {strategy.buy} with {strategy.amount} {strategy.sell} every {strategy.everyHours} h
                </span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {strategy.status === 'active' && strategy.nextRunAt
                    ? `Next ${formatUtc(strategy.nextRunAt)}`
                    : 'Paused'}
                  {strategy.lastRunAt ? ` · last ${formatUtc(strategy.lastRunAt)}` : ''}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <Chip tone={strategy.status === 'active' ? 'success' : 'neutral'} dot>
                  {strategy.status === 'active' ? 'Active' : 'Paused'}
                </Chip>
                <Button
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  aria-label={strategy.status === 'active' ? 'Pause' : 'Resume'}
                  onClick={() =>
                    change.mutate({
                      action: strategy.status === 'active' ? 'pause' : 'resume',
                      strategyId: strategy.id,
                    })
                  }
                >
                  {strategy.status === 'active' ? <Pause /> : <Play />}
                </Button>
                <Button
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  aria-label="Delete"
                  onClick={() => change.mutate({ action: 'remove', strategyId: strategy.id })}
                >
                  <Trash2 />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-5 border-t border-border pt-4 text-[12.5px] leading-relaxed text-muted-foreground">
        The agent only acts while your signed policy is active and within it. What it queues waits for one tap from you
        to sign, and a freeze stops it at once.
      </p>
    </Panel>
  );
}

function FormField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-[12.5px] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/** The actions the agent queued under the owner's policy, each ready to review and sign. */
export function AgentQueue() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const queue = useQuery({
    queryKey: ['agent-queue', wallet.address],
    queryFn: autopilot.queue,
    enabled: Boolean(wallet.address),
    refetchInterval: 30_000,
  });
  const dismiss = useMutation({
    mutationFn: autopilot.dismiss,
    onSuccess: (data) => queryClient.setQueryData(['agent-queue', wallet.address], data),
  });
  const items = queue.data?.queue ?? [];
  return (
    <Panel label="Queued by your agent" icon={<Bot />} labelId="agent-queue" bodyClassName="p-5">
      {items.length === 0 ? (
        <EmptyState
          icon={<Bot />}
          title="Nothing waiting for you"
          description="When a strategy comes due under your signed policy, the agent queues it here for you to sign."
        />
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="space-y-2">
              <p className="flex items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
                <span>Queued {formatUtc(item.queuedAt)}</span>
                <Button
                  variant="ghost"
                  className="h-8 gap-1.5 px-2 text-[12.5px]"
                  onClick={() => dismiss.mutate(item.id)}
                >
                  <X className="size-3.5" /> Dismiss
                </Button>
              </p>
              <SwapProposalCard intentId={item.intent.id} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
