import { Badge } from '@harbor/ui/components/badge';
import { Button } from '@harbor/ui/components/button';
import { Skeleton } from '@harbor/ui/components/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@harbor/ui/components/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@harbor/ui/components/tabs';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type ActivityItem, ExecutionRequestError, execution, type Quote } from '../lib/execution.ts';
import { swapDraftRequest } from '../lib/swap-draft.ts';
import { useWallet } from '../lib/wallet.tsx';
import { Fact, useCountdown } from './swap-proposal.tsx';
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

export function RouteFacts({ quote }: { quote: Quote | null }) {
  const secondsLeft = useCountdown(quote?.expiresAt);
  if (!quote) {
    return (
      <div className="space-y-3 text-sm">
        <Badge variant="outline">Cross-chain intents</Badge>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Enter an amount. The route, minimum received and price impact appear here for that exact size.
        </p>
      </div>
    );
  }
  const rate = Number(quote.expectedOut.amount) / Number(quote.sell.amount);
  return (
    <div className="space-y-3 text-sm">
      <Badge variant="secondary">{quote.venue}</Badge>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <Fact label="Expected" value={`${quote.expectedOut.amount} ${quote.expectedOut.symbol}`} />
        <Fact label="At least" value={`${quote.minimumOut.amount} ${quote.minimumOut.symbol}`} />
        <Fact label="Rate" value={`${formatPrice(rate)} ${quote.expectedOut.symbol}/${quote.sell.symbol}`} />
        <Fact
          label="Price impact"
          value={quote.priceImpactBps === null ? 'Not reported' : `${quote.priceImpactBps / 100}%`}
        />
        <Fact label="Slippage" value={`${quote.slippageBps / 100}%`} />
        <Fact label="Through" value={quote.protocols.join(', ') || quote.venue} />
        <Fact label="Harbor fee" value="0" />
      </dl>
      <p className="text-xs text-subtle">
        {secondsLeft === null || secondsLeft > 0
          ? `Quote valid for ${secondsLeft ?? '…'}s. The policy check runs when you review.`
          : 'Quote expired. Change the amount or pair to get a new quote.'}
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
  if (activity.isPending) return <Skeleton className="h-44 w-full" />;
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
    <Tabs defaultValue="swaps">
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger className="min-h-11" value="swaps">
          Swaps
        </TabsTrigger>
        <TabsTrigger className="min-h-11" value="pending">
          Pending{pending.length > 0 ? ` (${pending.length})` : ''}
        </TabsTrigger>
        <TabsTrigger className="min-h-11" value="history">
          History
        </TabsTrigger>
      </TabsList>
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Sent</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Transaction</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {ACTIVITY_TIME.format(Date.parse(item.createdAt))}
            </TableCell>
            <TableCell>
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.venue}</p>
            </TableCell>
            <TableCell className="font-mono tabular-nums">{amounts(item.sent)}</TableCell>
            <TableCell>
              <StatusBadge status={item.status} />
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
  );
}

function StatusBadge({ status }: { status: ActivityItem['status'] }) {
  if (status === 'confirmed') return <Badge variant="secondary">Confirmed</Badge>;
  if (status === 'submitted' || status === 'confirming') return <Badge variant="outline">Pending</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>;
  if (status === 'refunded') return <Badge variant="outline">Refunded</Badge>;
  if (status === 'outcome_unknown') return <Badge variant="destructive">Outcome unknown</Badge>;
  return <Badge variant="outline">{status === 'expired' ? 'Expired' : status.replaceAll('_', ' ')}</Badge>;
}

function amounts(list: ActivityItem['sent']): string {
  return list.length === 0 ? '—' : list.map((amount) => `${amount.amount} ${amount.symbol}`).join(' + ');
}
