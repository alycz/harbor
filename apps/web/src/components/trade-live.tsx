import { Button } from '@harbor/ui/components/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@harbor/ui/components/table';
import { Tabs, TabsContent } from '@harbor/ui/components/tabs';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, History, RefreshCw, TriangleAlert, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Skeleton } from 'skullet/react';

import { type ActivityItem, ExecutionRequestError, execution, type Quote } from '../lib/execution.ts';
import { formatTokenAmount, venueName } from '../lib/format.ts';
import { SAMPLE_ACTIVITY } from '../lib/samples.ts';
import { swapDraftRequest } from '../lib/swap-draft.ts';
import { useWallet } from '../lib/wallet.tsx';
import { RollText } from './motion.tsx';
import { Chip, type ChipTone, EmptyState, LineTab, LineTabsList } from './workspace.tsx';

const QUOTE_DELAY_MS = 600;
const ACTIVITY_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function useSwapDraft(sell: string, buy: string, amount: string) {
  const [intentId, setIntentId] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const key = `${sell}:${buy}:${amount}`;
  const ready = swapDraftRequest(sell, buy, amount) !== null;

  useEffect(() => {
    setIntentId(null);
    setQuote(null);
    setError(null);
    const request = swapDraftRequest(sell, buy, amount);
    if (!request) return;
    let active = true;
    const timer = setTimeout(() => {
      execution.createSwap(request).then(
        (intent) => {
          if (active) {
            setDraftKey(key);
            setIntentId(intent.id);
          }
        },
        (caught: unknown) => {
          if (active) setError(caught instanceof ExecutionRequestError ? caught.message : 'The quote request failed.');
        },
      );
    }, QUOTE_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sell, buy, amount, ready, key]);

  const current = ready && draftKey === key;
  return {
    intentId: current ? intentId : null,
    quote: current ? quote : null,
    setQuote,
    error,
    waiting: ready && (!current || !intentId) && !error,
  };
}

export function WalletActivity() {
  const wallet = useWallet();
  const activity = useQuery({
    queryKey: ['activity', wallet.address],
    queryFn: () => execution.activity(),
    enabled: Boolean(wallet.address),
    refetchInterval: 20_000,
  });
  if (!wallet.address && !wallet.restoring) {
    return (
      <EmptyState
        icon={<History />}
        title="Connect a wallet to see its activity"
        description="Swaps you sign through Harbor appear here once they reach the network."
      >
        <Button className="h-10 gap-2 px-4" onClick={wallet.connect} disabled={wallet.connecting}>
          <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
        </Button>
      </EmptyState>
    );
  }
  if (activity.isError) {
    return (
      <EmptyState icon={<TriangleAlert />} title="Activity could not be loaded" description={activity.error.message}>
        <Button variant="outline" className="h-9 gap-2" onClick={() => void activity.refetch()}>
          <RefreshCw /> Try again
        </Button>
      </EmptyState>
    );
  }
  return (
    <Skeleton
      id="wallet-activity"
      label="Loading activity"
      loading={wallet.restoring || activity.isPending}
      data={activity.data?.items}
      sample={SAMPLE_ACTIVITY}
    >
      {(items) => <ActivityTabs items={items} />}
    </Skeleton>
  );
}

function ActivityTabs({ items }: { items: ActivityItem[] }) {
  const pending = items.filter((item) => item.status === 'submitted' || item.status === 'confirming');
  return (
    <Tabs defaultValue="swaps" className="gap-0">
      <LineTabsList label="Activity views">
        <LineTab value="swaps">Swaps</LineTab>
        <LineTab value="pending">Pending{pending.length > 0 ? ` (${pending.length})` : ''}</LineTab>
        <LineTab value="history">History</LineTab>
      </LineTabsList>
      <TabsContent value="swaps">
        <ActivityTable
          items={items.filter((item) => item.kind === 'swap')}
          empty="No swaps from this wallet yet. Confirmed swaps appear here with what you sent and received."
        />
      </TabsContent>
      <TabsContent value="pending">
        <ActivityTable items={pending} empty="Nothing is waiting for the network to confirm." />
      </TabsContent>
      <TabsContent value="history">
        <ActivityTable items={items} empty="Nothing from this wallet has reached the network through Harbor yet." />
      </TabsContent>
    </Tabs>
  );
}

function ActivityTable({ items, empty }: { items: ActivityItem[]; empty: string }) {
  if (items.length === 0) return <p className="py-12 text-center text-[13.5px] text-muted-foreground">{empty}</p>;
  return (
    <Table
      containerClassName="ws-table -mx-5 w-[calc(100%+2.5rem)] overflow-x-auto"
      style={{ ['--ws-cols' as string]: 5 }}
    >
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {['When', 'Action', 'Sent', 'Status', 'Transaction'].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="ws-num text-muted-foreground">
              {ACTIVITY_TIME.format(Date.parse(item.createdAt))}
            </TableCell>
            <TableCell>
              <p className="font-medium">{item.title}</p>
              <p className="text-[12.5px] text-muted-foreground">{venueName(item.venue)}</p>
            </TableCell>
            <TableCell className="ws-num">{amounts(item.sent)}</TableCell>
            <TableCell>
              <StatusTag status={item.status} />
            </TableCell>
            <TableCell>
              {item.explorerUrl ? (
                <a
                  href={item.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ws-link inline-flex items-center gap-1 text-[13px]"
                >
                  View <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const STATUS: Record<string, { label: string; tone: ChipTone }> = {
  policy_checked: { label: 'Policy checked', tone: 'neutral' },
  blocked: { label: 'Blocked by policy', tone: 'danger' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  submitted: { label: 'Pending', tone: 'accent' },
  confirming: { label: 'Pending', tone: 'accent' },
  awaiting_review: { label: 'Awaiting review', tone: 'accent' },
  awaiting_signature: { label: 'Awaiting signature', tone: 'accent' },
  failed: { label: 'Failed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  outcome_unknown: { label: 'Outcome unknown', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
};

/** A plan's state as a rounded chip. When the state changes, the word rolls instead of swapping. */
export function StatusTag({ status }: { status: string }) {
  const fallback = status.replaceAll('_', ' ');
  const known = STATUS[status] ?? { label: fallback.charAt(0).toUpperCase() + fallback.slice(1), tone: 'neutral' };
  return (
    <Chip tone={known.tone} dot>
      <RollText id={known.label}>{known.label}</RollText>
    </Chip>
  );
}

function amounts(list: ActivityItem['sent']): string {
  return list.length === 0
    ? '—'
    : list.map((amount) => `${formatTokenAmount(amount.amount)} ${amount.symbol}`).join(' + ');
}
