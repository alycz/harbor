import { Button } from '@harbor/ui/components/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@harbor/ui/components/table';
import { Tabs, TabsContent } from '@harbor/ui/components/tabs';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type ActivityItem, ExecutionRequestError, execution, type Quote } from '../lib/execution.ts';
import { formatTokenAmount, venueName } from '../lib/format.ts';
import { swapDraftRequest } from '../lib/swap-draft.ts';
import { useWallet } from '../lib/wallet.tsx';
import { FactRow, LineTab, LineTabsList } from './brand.tsx';
import { ActivitySkeleton } from './skeletons.tsx';
import { useCountdown } from './swap-proposal.tsx';
import { EmptyState } from './workspace.tsx';

const QUOTE_DELAY_MS = 600;
const ACTIVITY_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(price);
}

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

export function RouteFacts({ quote }: { quote: Quote }) {
  const secondsLeft = useCountdown(quote.expiresAt);
  const rate = Number(quote.expectedOut.amount) / Number(quote.sell.amount);
  return (
    <div className="space-y-4">
      <dl>
        <FactRow
          label="You send"
          value={`${formatTokenAmount(quote.sell.amount)} ${quote.sell.symbol}`}
          title={quote.sell.amount}
        />
        <FactRow
          label="Expected"
          value={`${formatTokenAmount(quote.expectedOut.amount)} ${quote.expectedOut.symbol}`}
          title={quote.expectedOut.amount}
        />
        <FactRow
          label="At least"
          value={
            <span className="font-semibold text-primary">
              {formatTokenAmount(quote.minimumOut.amount)} {quote.minimumOut.symbol}
            </span>
          }
          title={quote.minimumOut.amount}
        />
        <FactRow label="Rate" value={`${formatPrice(rate)} ${quote.expectedOut.symbol} per ${quote.sell.symbol}`} />
        <FactRow
          label="Price impact"
          value={quote.priceImpactBps === null ? 'Not reported' : `${quote.priceImpactBps / 100}%`}
        />
        <FactRow label="Slippage limit" value={`${quote.slippageBps / 100}%`} />
        <FactRow label="Through" value={venueName(quote.venue)} />
        <FactRow label="Harbor fee" value="None" />
      </dl>
      <p className="text-xs text-muted-foreground">
        {secondsLeft === null || secondsLeft > 0
          ? 'The policy check runs when you review the swap.'
          : 'This quote expired. Change the amount or pair to get a new one.'}
      </p>
    </div>
  );
}

export function WalletActivity() {
  const wallet = useWallet();
  const activity = useQuery({
    queryKey: ['activity', wallet.address],
    queryFn: () => execution.activity(wallet.address ?? ''),
    enabled: Boolean(wallet.address),
    refetchInterval: 20_000,
  });
  if (wallet.restoring) return <ActivitySkeleton />;
  if (!wallet.address) {
    return (
      <EmptyState
        title="Connect a wallet to see its activity"
        description="Swaps you sign through Harbor appear here once they reach the network."
      >
        <Button onClick={wallet.connect} disabled={wallet.connecting}>
          <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
        </Button>
      </EmptyState>
    );
  }
  if (activity.isPending) return <ActivitySkeleton />;
  if (activity.isError) {
    return (
      <EmptyState title="Activity could not be loaded" description={activity.error.message}>
        <Button variant="outline" size="sm" onClick={() => void activity.refetch()}>
          <RefreshCw /> Try again
        </Button>
      </EmptyState>
    );
  }
  const items = activity.data.items;
  const pending = items.filter((item) => item.status === 'submitted' || item.status === 'confirming');
  return (
    <Tabs defaultValue="swaps" className="gap-4">
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
  if (items.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="border border-line">
      <Table>
        <TableHeader>
          <TableRow className="border-line hover:bg-transparent">
            {['When', 'Action', 'Sent', 'Status', 'Transaction'].map((label) => (
              <TableHead
                key={label}
                className={`h-10 bg-secondary text-[11px] font-medium tracking-[0.6px] text-muted-foreground uppercase ${label === 'Transaction' ? 'text-right' : ''}`}
              >
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className="border-line">
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {ACTIVITY_TIME.format(Date.parse(item.createdAt))}
              </TableCell>
              <TableCell>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">{venueName(item.venue)}</p>
              </TableCell>
              <TableCell className="tabular-nums">{amounts(item.sent)}</TableCell>
              <TableCell>
                <StatusTag status={item.status} />
              </TableCell>
              <TableCell className="text-right">
                {item.explorerUrl ? (
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    View <ExternalLink className="size-3" />
                  </a>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const STATUS: Record<string, { label: string; tone: string }> = {
  confirmed: { label: 'Confirmed', tone: 'border-success text-success' },
  submitted: { label: 'Pending', tone: 'border-primary text-primary' },
  confirming: { label: 'Pending', tone: 'border-primary text-primary' },
  failed: { label: 'Failed', tone: 'border-destructive text-destructive' },
  refunded: { label: 'Refunded', tone: 'border-line text-muted-foreground' },
  outcome_unknown: { label: 'Outcome unknown', tone: 'border-destructive text-destructive' },
  expired: { label: 'Expired', tone: 'border-line text-muted-foreground' },
};

/** A plan's state as a small ruled tag. */
export function StatusTag({ status }: { status: string }) {
  const known = STATUS[status] ?? { label: status.replaceAll('_', ' '), tone: 'border-line text-muted-foreground' };
  return (
    <span
      className={`inline-block border px-1.5 py-0.5 text-[10px] font-medium tracking-[0.6px] whitespace-nowrap uppercase ${known.tone}`}
    >
      {known.label}
    </span>
  );
}

function amounts(list: ActivityItem['sent']): string {
  return list.length === 0
    ? '—'
    : list.map((amount) => `${formatTokenAmount(amount.amount)} ${amount.symbol}`).join(' + ');
}
