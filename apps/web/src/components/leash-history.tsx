import { Button } from '@harbor/ui/components/button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, History, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';

import { call, type SwapAsset } from '../lib/execution.ts';
import { formatUtc } from '../lib/format.ts';
import { canSubmitLeash, fromAtomic } from '../lib/leash-ui.ts';
import { Chip, type ChipTone, EmptyState, Panel } from './workspace.tsx';

interface SwapRecord {
  id: string;
  createdAtMs: number;
  amountIn: string;
  originAsset: string;
  destinationAsset: string;
  minAmountOut: string;
  recipient: string;
  state: string;
  txHash: string | null;
}

/** What Harbor's check of one swap found: how far it got, and the proof once it is delivered. */
interface SwapCheck {
  id: string;
  state: string;
  settled?: boolean;
  txHash?: string;
  receivedRaw?: string;
}

/** The ways a swap can end without the tokens arriving; Harbor stops asking after one of these. */
const FAILED = new Set([
  'failed',
  'mismatch',
  'quote-mismatch',
  'refund-reported-unverified',
  'provider-failure-reported',
  'delivery-unverifiable',
]);

const WORDS: Record<string, { label: string; tone: ChipTone; note: string }> = {
  'approved-not-submitted': {
    label: 'Approved, not sent',
    tone: 'warning',
    note: 'You approved this quote but the agent has not sent it. Nothing left your vault.',
  },
  'submission-requested': {
    label: 'Sending',
    tone: 'neutral',
    note: 'The agent is sending the payment.',
  },
  submitted: { label: 'Paid, checking delivery', tone: 'neutral', note: 'The payment is on its way to NEAR Intents.' },
  pending: { label: 'Waiting for NEAR', tone: 'neutral', note: 'The payment is not final on chain yet.' },
  'delivery-pending': {
    label: 'Swap in progress',
    tone: 'neutral',
    note: 'NEAR Intents is still working on it. This page checks again every few seconds.',
  },
  'delivery-unverified': {
    label: 'Paid, tokens not here yet',
    tone: 'neutral',
    note: 'NEAR Intents says it is done, but the tokens have not shown up in your account yet.',
  },
  'delivery-verified': { label: 'Delivered', tone: 'success', note: 'The tokens are in your account.' },
  'outcome-unknown': {
    label: 'Could not check yet',
    tone: 'neutral',
    note: 'Harbor could not read the result just now. The payment itself is on chain. This page tries again.',
  },
  failed: { label: 'Failed on chain', tone: 'danger', note: 'The payment failed on NEAR, so nothing was spent.' },
  mismatch: {
    label: 'Not what you approved',
    tone: 'danger',
    note: 'The transaction on chain differs from the quote you approved. Harbor does not count it.',
  },
  'quote-mismatch': {
    label: 'Not what you approved',
    tone: 'danger',
    note: 'The quote on record differs from the one that was paid. Harbor does not count it.',
  },
  'refund-reported-unverified': {
    label: 'Refunded',
    tone: 'warning',
    note: 'NEAR Intents reports a refund. Check your account for the returned funds.',
  },
  'provider-failure-reported': {
    label: 'NEAR Intents reported a failure',
    tone: 'danger',
    note: 'The swap did not complete. Check your account before trying again.',
  },
  'delivery-unverifiable': {
    label: 'Paid, delivery not checkable',
    tone: 'warning',
    note: 'Harbor cannot confirm delivery of this asset automatically. Check the destination account yourself.',
  },
};

function describe(state: string) {
  return WORDS[state] ?? { label: state.replaceAll('-', ' '), tone: 'neutral' as const, note: '' };
}

/** Every swap the agent made for this owner, each checking its own delivery until it is settled or has failed. */
export function SwapHistory({
  owner,
  registry,
  executionAvailable,
}: {
  owner: string;
  registry: readonly SwapAsset[];
  executionAvailable: boolean;
}) {
  const list = useQuery({
    queryKey: ['leash-executions', owner],
    queryFn: () => call<{ items: SwapRecord[] }>('/api/leash/executions'),
    retry: false,
  });
  const items = list.data?.items ?? [];
  return (
    <Panel label="Agent swaps" icon={<History />} labelId="leash-history" bodyClassName="p-5 @xl/workspace:p-6">
      {list.isPending ? (
        <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Reading the agent's swaps…
        </p>
      ) : list.error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {list.error.message}
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="No swaps yet"
          description="When the agent pays a quote you approved, it shows up here with its status and proof."
        />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <SwapRow
              key={item.id}
              item={item}
              owner={owner}
              registry={registry}
              executionAvailable={executionAvailable}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SwapRow({
  item,
  owner,
  registry,
  executionAvailable,
}: {
  item: SwapRecord;
  owner: string;
  registry: readonly SwapAsset[];
  executionAvailable: boolean;
}) {
  const queryClient = useQueryClient();
  const paid = registry.find((asset) => asset.canonicalId === item.originAsset);
  const bought = registry.find((asset) => asset.canonicalId === item.destinationAsset);
  const checkable = item.state !== 'approved-not-submitted';
  const check = useQuery({
    queryKey: ['leash-execution', item.id],
    queryFn: () => call<SwapCheck>(`/api/leash/executions/${encodeURIComponent(item.id)}`),
    enabled: checkable,
    retry: false,
    // Ask again every few seconds until it is delivered or has clearly failed, and not for ever.
    refetchInterval: (query) => {
      const data = query.state.data;
      const recent = Date.now() - item.createdAtMs < 30 * 60_000;
      return data?.settled || FAILED.has(data?.state ?? '') || !recent ? false : 10_000;
    },
  });
  const send = useMutation({
    mutationFn: () => call(`/api/leash/executions/${encodeURIComponent(item.id)}/submit`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Sent', { description: 'The agent is paying from your vault.' });
      void queryClient.invalidateQueries({ queryKey: ['leash-executions', owner] });
      void queryClient.invalidateQueries({ queryKey: ['leash-vault', owner] });
    },
  });

  const checked = check.data;
  const state = checked?.state ?? item.state;
  const words = describe(check.isError ? 'outcome-unknown' : state);
  const txHash = checked?.txHash && checked.settled ? checked.txHash : null;
  const paidAmount = paid ? fromAtomic(item.amountIn, paid.decimals) : item.amountIn;
  const received =
    checked?.settled && checked.receivedRaw && bought ? fromAtomic(checked.receivedRaw, bought.decimals) : null;
  const atLeast = bought ? fromAtomic(item.minAmountOut, bought.decimals) : item.minAmountOut;

  async function checkAgain() {
    const result = await check.refetch();
    const next = result.data;
    if (result.isError || !next) return toast('Could not check just now. Try again in a moment.');
    const found = describe(next.state);
    toast(found.label, { description: found.note || undefined });
  }

  return (
    <li className="space-y-2.5 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <p className="text-[14px] font-medium">
          Paid <span className="ws-num">{paidAmount}</span> {paid?.symbol ?? ''} for {bought?.symbol ?? 'tokens'}
        </p>
        <Chip tone={words.tone} dot>
          {words.label}
        </Chip>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {formatUtc(new Date(item.createdAtMs).toISOString())} ·{' '}
        {received ? (
          <>
            Received <span className="ws-num font-medium text-foreground">{received}</span> {bought?.symbol} (you were
            promised at least <span className="ws-num">{atLeast}</span>)
          </>
        ) : (
          <>
            You will receive at least <span className="ws-num">{atLeast}</span> {bought?.symbol}
          </>
        )}
      </p>
      {words.note ? <p className="text-[12.5px] text-muted-foreground">{words.note}</p> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {item.txHash ? (
          <a
            href={`https://nearblocks.io/txns/${item.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ws-accent-ink)] hover:underline"
          >
            The agent's payment <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
        {txHash && bought?.chain === 'near' ? (
          <a
            href={`https://nearblocks.io/txns/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ws-accent-ink)] hover:underline"
          >
            The delivery <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
        {canSubmitLeash(executionAvailable, send.isPending, false, state) ? (
          <Button className="h-9 px-3.5" disabled={send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
            Send it
          </Button>
        ) : null}
        {checkable && !checked?.settled && !FAILED.has(state) ? (
          <Button
            variant="outline"
            className="h-9 px-3.5"
            disabled={check.isFetching}
            onClick={() => void checkAgain()}
          >
            {check.isFetching ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
            Check again
          </Button>
        ) : null}
      </div>
      {send.isError ? (
        <p role="alert" className="text-[13px] text-destructive">
          {send.error.message}
        </p>
      ) : null}
    </li>
  );
}
