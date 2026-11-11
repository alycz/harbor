import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Pause, Play, Plus, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';

import { autopilot } from '../lib/autopilot.ts';
import { execution } from '../lib/execution.ts';
import { formatUtc } from '../lib/format.ts';
import { useWallet } from '../lib/wallet.tsx';
import { SwapProposalCard } from './swap-proposal.tsx';
import { Chip, EmptyState, Panel } from './workspace.tsx';

const SELECT =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40';

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
  const [draft, setDraft] = useState({ sell: 'NEAR', buy: 'USDC', amount: '0.5', everyHours: 24 });
  const set = (data: Awaited<ReturnType<typeof autopilot.strategies>>) =>
    queryClient.setQueryData(['strategies', wallet.address], data);
  const create = useMutation({ mutationFn: () => autopilot.create(draft), onSuccess: set });
  const change = useMutation({
    mutationFn: ({ action, strategyId }: { action: 'pause' | 'resume' | 'remove'; strategyId: string }) =>
      autopilot[action](strategyId),
    onSuccess: set,
  });
  const all = assets.data?.assets ?? [];
  const sellable = all.filter((asset) => asset.chain === 'near');

  return (
    <Panel
      label="What the agent does on its own"
      icon={<Bot />}
      labelId="strategies"
      bodyClassName="p-5 @xl/workspace:p-6"
    >
      <div className="grid gap-3 @xl/workspace:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-amount`}>
          Spend
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
            {sellable.map((asset) => (
              <option key={asset.symbol}>{asset.symbol}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-buy`}>
          To buy
          <select
            id={`${id}-buy`}
            className={SELECT}
            value={draft.buy}
            onChange={(event) => setDraft({ ...draft, buy: event.target.value })}
          >
            {all.map((asset) => (
              <option key={asset.symbol}>{asset.symbol}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5 text-[12.5px] text-muted-foreground" htmlFor={`${id}-every`}>
          Every (hours)
          <Input
            id={`${id}-every`}
            className="h-10"
            inputMode="numeric"
            value={String(draft.everyHours)}
            onChange={(event) => setDraft({ ...draft, everyHours: Number(event.target.value) || 1 })}
          />
        </label>
        <Button className="mt-auto h-10 gap-2 px-4" disabled={create.isPending} onClick={() => create.mutate()}>
          <Plus /> Add
        </Button>
      </div>
      {create.isError ? <p className="mt-2 text-[13px] text-destructive">{create.error.message}</p> : null}
      <ul className="mt-5 divide-y divide-border border-t border-border">
        {(strategies.data?.strategies ?? []).map((strategy) => (
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
                  change.mutate({ action: strategy.status === 'active' ? 'pause' : 'resume', strategyId: strategy.id })
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
      <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
        The agent only acts while your signed policy is active and within it. What it queues waits for one tap from you
        to sign, and a freeze stops it at once.
      </p>
    </Panel>
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
