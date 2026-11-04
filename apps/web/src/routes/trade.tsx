import { Button } from '@harbor/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp } from 'lucide-react';
import { useCallback, useState } from 'react';

import { AssetIcon } from '../components/asset-icon.tsx';
import { AssetPicker, type PickerAsset } from '../components/asset-picker.tsx';
import { Panel } from '../components/brand.tsx';
import { ReviewRequirements } from '../components/financial-draft.tsx';
import { AssetGridSkeleton, FactRowsSkeleton, QuoteSkeleton, TicketSkeleton } from '../components/skeletons.tsx';
import { SwapProposalCard, useCountdown } from '../components/swap-proposal.tsx';
import { RouteFacts, useSwapDraft, WalletActivity } from '../components/trade-live.tsx';
import { EmptyState, PageHeader } from '../components/workspace.tsx';
import { execution, type Quote } from '../lib/execution.ts';
import { formatTokenAmount } from '../lib/format.ts';
import { useHealth } from '../lib/health.ts';

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
  }

  return (
    <div className="trade-workspace flex min-w-0 flex-col gap-8">
      <PageHeader
        kicker="Cross-chain intents"
        title="Trade"
        description="Swap between NEAR and other chains through NEAR Intents. Quotes are live; you review every swap and sign it in your own wallet."
      />
      <div className="trade-grid">
        <Panel
          label="Route"
          aside={
            quote
              ? secondsLeft === 0
                ? 'Quote expired'
                : `Live quote · ${secondsLeft ?? '…'}s`
              : quoting
                ? 'Quoting…'
                : 'No quote yet'
          }
          className="trade-routes"
          labelId="trade-routes-title"
        >
          {quote ? (
            <RouteFacts quote={quote} />
          ) : quoting ? (
            <FactRowsSkeleton rows={8} />
          ) : assets.isPending ? (
            <AssetGridSkeleton />
          ) : (
            <SupportedAssets assets={options} />
          )}
        </Panel>
        <Panel label="Market swap" aside={network} className="trade-ticket" labelId="trade-ticket-title">
          {assets.isPending ? (
            <TicketSkeleton />
          ) : options.length < 2 ? (
            <EmptyState
              title="No swap assets on this server"
              description="This network has no verified swap assets configured yet, so nothing can be quoted."
            />
          ) : (
            <div className="space-y-4">
              <div className="trade-asset-box">
                <p className="trade-box-label">You pay</p>
                <div className="flex items-center gap-3">
                  <label className="sr-only" htmlFor="trade-amount">
                    Amount
                  </label>
                  <input
                    id="trade-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    disabled={locked}
                    value={amount}
                    onChange={(event) => setAmount(event.currentTarget.value)}
                    className="trade-amount-input"
                  />
                  <AssetPicker
                    label="You pay"
                    value={inputAsset}
                    options={options}
                    disabled={locked}
                    onChange={(value) => choose('input', value)}
                  />
                </div>
              </div>
              <div className="-my-2 flex justify-center">
                <Button
                  variant="outline"
                  size="icon"
                  className="relative z-10 size-11 bg-card"
                  disabled={locked}
                  aria-label="Reverse input and output assets"
                  onClick={reversePair}
                >
                  <ArrowDownUp />
                </Button>
              </div>
              <div className="trade-asset-box">
                <p className="trade-box-label">
                  <span>You receive</span>
                  <span>{quote ? (secondsLeft === 0 ? 'Quote expired' : 'Estimate') : ''}</span>
                </p>
                <div className="flex items-center gap-3">
                  <output
                    className="trade-amount-output"
                    aria-label="Estimated receive"
                    title={quote?.expectedOut.amount}
                    data-empty={quote && secondsLeft !== 0 ? undefined : ''}
                  >
                    {quote && secondsLeft !== 0 ? formatTokenAmount(quote.expectedOut.amount) : '0'}
                  </output>
                  <AssetPicker
                    label="You receive"
                    value={outputAsset}
                    options={options}
                    disabled={locked}
                    onChange={(value) => choose('output', value)}
                  />
                </div>
              </div>
              {intentId ? (
                <SwapProposalCard key={intentId} intentId={intentId} onQuote={onQuote} onInteractionLock={setLocked} />
              ) : draft.waiting ? (
                <QuoteSkeleton />
              ) : draft.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {draft.error}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Enter an amount to get a live quote.</p>
              )}
              <ReviewRequirements />
            </div>
          )}
        </Panel>
        <Panel label="Swap history" className="trade-positions" labelId="trade-positions-title">
          <WalletActivity />
        </Panel>
      </div>
    </div>
  );
}

/** What can be swapped here, shown until there is a quote to describe. */
function SupportedAssets({ assets }: { assets: PickerAsset[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Enter an amount and the route, the minimum you receive and the quote's expiry appear here for that exact size.
        These are the assets you can swap:
      </p>
      <ul className="grid grid-cols-2 border-t border-l border-line sm:grid-cols-4">
        {assets.map((asset) => (
          <li key={asset.symbol} className="flex items-center gap-3 border-r border-b border-line p-3">
            <AssetIcon symbol={asset.symbol} className="size-8" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{asset.symbol}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{asset.name}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
