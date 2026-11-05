import { Button } from '@harbor/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, ArrowLeftRight, Coins, History, Route } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useState } from 'react';
import { Skeleton } from 'skullet/react';

import { AssetIcon } from '../components/asset-icon.tsx';
import { AssetPicker, type PickerAsset } from '../components/asset-picker.tsx';
import { ReviewRequirements } from '../components/financial-draft.tsx';
import { RollingNumber, RollText } from '../components/motion.tsx';
import { QuoteSkeleton } from '../components/skeletons.tsx';
import { SwapProposalCard, useCountdown } from '../components/swap-proposal.tsx';
import { useSwapDraft, WalletActivity } from '../components/trade-live.tsx';
import { Chip, EmptyState, FactRow, Panel, Stat } from '../components/workspace.tsx';
import { execution, type Quote } from '../lib/execution.ts';
import { formatTokenAmount, venueName } from '../lib/format.ts';
import { useHealth } from '../lib/health.ts';
import { SAMPLE_ASSETS } from '../lib/samples.ts';

const ARRIVE = [0.25, 0.8, 0.25, 1] as const;

export function TradePage() {
  const health = useHealth();
  const assets = useQuery({ queryKey: ['assets'], queryFn: execution.assets, staleTime: 5 * 60_000 });
  const options: PickerAsset[] = (assets.data?.assets ?? []).map((asset) => ({
    symbol: asset.symbol,
    name: asset.name,
  }));
  const [chosenInput, setInputAsset] = useState<string | null>(null);
  const [chosenOutput, setOutputAsset] = useState<string | null>(null);
  const inputAsset = chosenInput ?? options[0]?.symbol ?? '';
  const outputAsset = chosenOutput ?? options.find((asset) => asset.symbol !== inputAsset)?.symbol ?? '';
  const [amount, setAmount] = useState('');
  const [locked, setLocked] = useState(false);
  const [flips, setFlips] = useState(0);
  const reduced = useReducedMotion();
  const draft = useSwapDraft(inputAsset, outputAsset, amount);
  const { intentId, quote, setQuote } = draft;
  const secondsLeft = useCountdown(quote?.expiresAt);
  // The proposal card fetches the quote once the intent exists; until it answers, the route is loading.
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  const onQuote = useCallback(
    (next: Quote | null) => {
      setQuote(next);
      setAnsweredFor(intentId);
    },
    [setQuote, intentId],
  );
  const quoting = draft.waiting || (intentId !== null && answeredFor !== intentId);
  const network = health.data?.network === 'testnet' ? 'Testnet' : 'Mainnet';
  const live = Boolean(quote && secondsLeft !== 0);
  const loadingAssets = assets.isPending;
  const pay = inputAsset || 'NEAR';
  const receive = outputAsset || 'USDC';

  /** Picking the asset already on the other side swaps the two sides. */
  function choose(side: 'input' | 'output', value: string) {
    if (side === 'input') {
      if (value === outputAsset) setOutputAsset(inputAsset);
      setInputAsset(value);
    } else {
      if (value === inputAsset) setInputAsset(outputAsset);
      setOutputAsset(value);
    }
    setAmount('');
  }

  function reversePair() {
    setInputAsset(outputAsset);
    setOutputAsset(inputAsset);
    setAmount('');
    setFlips((count) => count + 1);
  }

  const status = quote
    ? secondsLeft === 0
      ? { id: 'expired', label: 'Quote expired', tone: 'warning' as const }
      : { id: 'live', label: 'Live quote', tone: 'success' as const }
    : quoting
      ? { id: 'quoting', label: 'Quoting…', tone: 'accent' as const }
      : { id: 'idle', label: 'No quote yet', tone: 'neutral' as const };

  return (
    <div className="trade-layout ws-stagger">
      {/* The pair: who you pay and who you receive, and the quote's terms at a glance (Royco's market header). */}
      <section aria-labelledby="trade-pair" className="ws-card min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex shrink-0 -space-x-2.5">
              <span className="rounded-full bg-card p-0.5">
                <AssetIcon symbol={pay} className="size-10" />
              </span>
              <span className="rounded-full bg-card p-0.5">
                <AssetIcon symbol={receive} className="size-10" />
              </span>
            </span>
            <div className="min-w-0">
              <h1 id="trade-pair" className="font-display truncate text-[28px] leading-tight">
                {pay} to {receive}
              </h1>
              <p className="ws-label mt-0.5">Cross-chain swap through NEAR Intents</p>
            </div>
          </div>
          <Chip tone={status.tone} dot>
            <RollText id={status.id}>{status.label}</RollText>
          </Chip>
        </div>
        <p className="mt-4 max-w-2xl px-5 text-[14px] leading-relaxed text-muted-foreground sm:px-6">
          Quotes are live and priced for your exact amount. You review every swap and sign it in your own wallet; Harbor
          never holds your keys.
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border px-5 py-4 sm:grid-cols-3 sm:px-6 lg:grid-cols-5">
          <Stat
            label="Rate"
            value={
              live && quote ? (
                <>
                  <RollingNumber value={formatRate(quote)} />{' '}
                  <span className="text-[13px] text-muted-foreground">{quote.expectedOut.symbol}</span>
                </>
              ) : (
                <Dash />
              )
            }
          />
          <Stat
            label="At least"
            title={quote?.minimumOut.amount}
            value={live && quote ? <RollingNumber value={formatTokenAmount(quote.minimumOut.amount, 4)} /> : <Dash />}
          />
          <Stat
            label="Price impact"
            value={
              live && quote ? (
                quote.priceImpactBps === null ? (
                  'Not reported'
                ) : (
                  `${quote.priceImpactBps / 100}%`
                )
              ) : (
                <Dash />
              )
            }
          />
          <Stat label="Slippage limit" value={live && quote ? `${quote.slippageBps / 100}%` : <Dash />} />
          <Stat label="Harbor fee" value="None" />
        </dl>
      </section>

      <Panel
        label="Route"
        icon={<Route />}
        aside={quote ? venueName(quote.venue) : `${options.length || '—'} assets`}
        labelId="trade-route-title"
        className="min-w-0"
      >
        {quote && live ? (
          <RouteView quote={quote} />
        ) : quoting ? (
          <div className="py-2">
            <RouteDiagram sell={pay} buy={receive} />
            <p className="mt-5 text-center text-[13px] text-muted-foreground">Finding the best route for this size…</p>
          </div>
        ) : (
          <Skeleton
            loading={loadingAssets}
            label="Loading swap assets"
            data={loadingAssets ? null : options}
            sample={SAMPLE_ASSETS}
          >
            {(list) => <SupportedAssets assets={list} />}
          </Skeleton>
        )}
      </Panel>

      <Panel
        label="Swap history"
        icon={<History />}
        labelId="trade-history-title"
        className="min-w-0"
        bodyClassName="px-5 pb-1"
      >
        <WalletActivity />
      </Panel>

      {/* The ticket: Royco's deposit panel. */}
      <section
        aria-labelledby="trade-ticket-title"
        className="trade-ticket ws-card min-w-0 shadow-[var(--ws-shadow-raised)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 id="trade-ticket-title" className="flex items-center gap-2 text-[14px] font-medium">
            <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden="true" />
            Swap
          </h2>
          {intentId ? null : <Chip tone={network === 'Mainnet' ? 'neutral' : 'warning'}>{network}</Chip>}
        </div>
        {!loadingAssets && options.length < 2 ? (
          <EmptyState
            icon={<Coins />}
            title="No swap assets on this server"
            description="This network has no verified swap assets configured yet, so nothing can be quoted."
          />
        ) : (
          <div className="space-y-3 p-4">
            <div className="relative space-y-1.5">
              <div className="ws-inset px-3.5 pt-3 pb-3.5">
                <label htmlFor="trade-amount" className="ws-label block text-[13px]">
                  You pay
                </label>
                <div className="mt-1.5 flex items-center gap-3">
                  <input
                    id="trade-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    disabled={locked || loadingAssets}
                    value={amount}
                    onChange={(event) => setAmount(event.currentTarget.value)}
                    className="trade-amount-input"
                  />
                  <AssetPicker
                    label="You pay"
                    value={pay}
                    options={options}
                    disabled={locked || loadingAssets}
                    onChange={(value) => choose('input', value)}
                  />
                </div>
              </div>
              <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9 rounded-[10px] border-[3px] border-card bg-secondary shadow-none hover:bg-[color-mix(in_oklab,var(--harbor-sand),var(--harbor-text)_6%)] pointer-coarse:size-11"
                  disabled={locked || loadingAssets}
                  aria-label="Reverse input and output assets"
                  onClick={reversePair}
                >
                  <motion.span
                    className="grid place-items-center"
                    animate={{ rotate: flips * 180 }}
                    transition={reduced ? { duration: 0 } : { duration: 0.42, ease: [0.45, 0, 0.1, 1] }}
                  >
                    <ArrowDownUp className="size-4" />
                  </motion.span>
                </Button>
              </div>
              <div className="ws-inset px-3.5 pt-3 pb-3.5">
                <p className="ws-label flex justify-between gap-3 text-[13px]">
                  <span>You receive</span>
                  <span>
                    <RollText id={quote ? (secondsLeft === 0 ? 'expired' : 'estimate') : 'none'}>
                      {quote ? (secondsLeft === 0 ? 'Quote expired' : 'Estimate') : ''}
                    </RollText>
                  </span>
                </p>
                <div className="mt-1.5 flex items-center gap-3">
                  <output
                    className="trade-amount-output"
                    aria-label="Estimated receive"
                    title={quote?.expectedOut.amount}
                    data-empty={live ? undefined : ''}
                  >
                    {live && quote ? <RollingNumber value={formatTokenAmount(quote.expectedOut.amount)} /> : '0'}
                  </output>
                  <AssetPicker
                    label="You receive"
                    value={receive}
                    options={options}
                    disabled={locked || loadingAssets}
                    onChange={(value) => choose('output', value)}
                  />
                </div>
              </div>
            </div>
            {intentId ? (
              <motion.div
                key={intentId}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.36, ease: ARRIVE }}
              >
                <SwapProposalCard intentId={intentId} onQuote={onQuote} onInteractionLock={setLocked} />
              </motion.div>
            ) : draft.waiting ? (
              <QuoteSkeleton />
            ) : draft.error ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/25 bg-destructive/6 px-3.5 py-3 text-[13px] text-destructive"
              >
                {draft.error}
              </p>
            ) : (
              <p className="px-1 py-1 text-[13px] text-muted-foreground">Enter an amount to get a live quote.</p>
            )}
            <div className="border-t border-border px-1 pt-3">
              <ReviewRequirements />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

function formatRate(quote: Quote): string {
  const rate = Number(quote.expectedOut.amount) / Number(quote.sell.amount);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: rate >= 100 ? 2 : rate >= 1 ? 4 : 6 }).format(rate);
}

/** The live quote: the path it takes, then the amounts at each end. */
function RouteView({ quote }: { quote: Quote }) {
  return (
    <div className="space-y-5">
      <RouteDiagram
        sell={quote.sell.symbol}
        buy={quote.expectedOut.symbol}
        sellAmount={formatTokenAmount(quote.sell.amount)}
        buyAmount={formatTokenAmount(quote.expectedOut.amount)}
        venue={venueName(quote.venue)}
        drawn
      />
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
            <span className="text-[var(--ws-accent-ink)]">
              {formatTokenAmount(quote.minimumOut.amount)} {quote.minimumOut.symbol}
            </span>
          }
          title={quote.minimumOut.amount}
        />
      </dl>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        The policy check runs when you review the swap.
      </p>
    </div>
  );
}

/**
 * The path a swap takes, drawn left to right: what you send, the solver network, what you receive.
 * Each connector draws on once both of its ends are in place and ends on a dot (Stageshow's Connector).
 */
function RouteDiagram({
  sell,
  buy,
  sellAmount,
  buyAmount,
  venue = 'NEAR Intents',
  drawn = false,
}: {
  sell: string;
  buy: string;
  sellAmount?: string;
  buyAmount?: string;
  venue?: string;
  drawn?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 pb-6 sm:gap-3" aria-label={`${sell} through ${venue} to ${buy}`} role="img">
      <RouteNode symbol={sell} amount={sellAmount} caption="You send" />
      <Connector drawn={drawn} delay={0.1} />
      <span className="relative shrink-0">
        <span className="grid size-10 place-items-center rounded-full border border-border bg-secondary/70 text-muted-foreground">
          <ArrowLeftRight className="size-4" aria-hidden="true" />
        </span>
        <span className="absolute top-full left-1/2 mt-1.5 -translate-x-1/2 text-[12px] font-medium whitespace-nowrap">
          {venue}
        </span>
      </span>
      <Connector drawn={drawn} delay={0.45} />
      <RouteNode symbol={buy} amount={buyAmount} caption="You receive" align="end" />
    </div>
  );
}

function RouteNode({
  symbol,
  amount,
  caption,
  align = 'start',
}: {
  symbol: string;
  amount?: string | undefined;
  caption: string;
  align?: 'start' | 'end';
}) {
  return (
    <span
      className={`flex min-w-0 shrink-0 items-center gap-2.5 ${align === 'end' ? 'flex-row-reverse text-right' : ''}`}
    >
      <AssetIcon symbol={symbol} className="size-10" />
      <span className="min-w-0">
        <span className="ws-num block truncate text-[14px] font-medium">{amount ? `${amount} ${symbol}` : symbol}</span>
        <span className="block text-[12px] text-muted-foreground">{caption}</span>
      </span>
    </span>
  );
}

/** A hairline that draws from left to right and ends on a dot; idle, it waits as a dashed guide. */
function Connector({ drawn, delay }: { drawn: boolean; delay: number }) {
  const reduced = useReducedMotion();
  return (
    <span aria-hidden="true" className="relative h-px min-w-6 flex-1">
      <span className="absolute inset-0 border-t border-dashed border-border-strong" />
      <motion.span
        className="absolute inset-0 origin-left bg-foreground/55"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: drawn ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : { duration: 0.8, ease: [0.45, 0, 0.1, 1], delay }}
      />
      <motion.span
        className="absolute top-1/2 right-0 size-1.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-foreground/70"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: drawn ? 1 : 0, scale: drawn ? 1 : 0.4 }}
        transition={reduced ? { duration: 0 } : { duration: 0.24, ease: ARRIVE, delay: delay + 0.72 }}
      />
    </span>
  );
}

/** What can be swapped here, shown until there is a quote to describe. */
function SupportedAssets({ assets }: { assets: PickerAsset[] }) {
  return (
    <div className="space-y-4">
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        Enter an amount and the route, the minimum you receive and the quote's expiry appear here for that exact size.
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {assets.map((asset) => (
          <li
            key={asset.symbol}
            className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-background/50 px-3 py-2.5"
          >
            <AssetIcon symbol={asset.symbol} className="size-7" />
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium">{asset.symbol}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{asset.name}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
