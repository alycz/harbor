import { Button } from '@harbor/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, LoaderCircle, Route } from 'lucide-react';
import { useState } from 'react';

import { AssetPicker, type PickerAsset } from '../components/asset-picker.tsx';
import { ReviewRequirements } from '../components/financial-draft.tsx';
import { SwapProposalCard, useCountdown } from '../components/swap-proposal.tsx';
import { RouteFacts, useSwapDraft, WalletActivity } from '../components/trade-live.tsx';
import { EmptyState } from '../components/workspace.tsx';
import { execution } from '../lib/execution.ts';
import { useHealth } from '../lib/health.ts';

export function TradePage() {
  const health = useHealth();
  const assets = useQuery({ queryKey: ['assets'], queryFn: execution.assets, staleTime: 5 * 60_000 });
  const options: PickerAsset[] = (assets.data?.assets ?? []).map((asset) => ({
    symbol: asset.symbol,
    name: asset.canonicalId,
  }));
  const [chosenInput, setInputAsset] = useState<string | null>(null);
  const [chosenOutput, setOutputAsset] = useState<string | null>(null);
  const inputAsset = chosenInput ?? options[0]?.symbol ?? '';
  const outputAsset = chosenOutput ?? options.find((asset) => asset.symbol !== inputAsset)?.symbol ?? '';
  const [amount, setAmount] = useState('');
  const [locked, setLocked] = useState(false);
  const draft = useSwapDraft(inputAsset, outputAsset, amount);
  const { intentId, quote } = draft;
  const secondsLeft = useCountdown(quote?.expiresAt);

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
    <div className="trade-workspace flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-serif text-[32px] font-semibold">Swap</h1>
          <p className="mt-1 text-xs text-subtle">
            Cross-chain intents · {health.data?.network === 'testnet' ? 'Testnet' : 'Mainnet'} · you sign every action
          </p>
        </div>
      </header>
      <div className="trade-grid">
        <section className="workspace-panel trade-routes min-w-0" aria-labelledby="trade-routes-title">
          <div className="border-b px-5 py-4">
            <h2 id="trade-routes-title" className="flex items-center gap-2 font-serif text-xl font-semibold">
              <Route className="size-4" /> Route
            </h2>
          </div>
          <div className="space-y-5 p-5">
            <RouteFacts quote={quote} />
          </div>
        </section>
        <section className="workspace-panel trade-ticket min-w-0" aria-labelledby="trade-ticket-title">
          <h2 id="trade-ticket-title" className="border-b px-5 py-4 font-serif text-xl font-semibold">
            Market swap
          </h2>
          {assets.isPending ? (
            <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Loading supported assets…
            </p>
          ) : options.length < 2 ? (
            <EmptyState
              title="No swap assets on this server"
              description="This network has no verified swap assets configured yet, so nothing can be quoted."
            />
          ) : (
            <div className="space-y-5 p-5">
              <div className="trade-asset-box">
                <p className="mb-3 text-[11px] text-subtle">You pay</p>
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
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11"
                  disabled={locked}
                  aria-label="Reverse input and output assets"
                  onClick={reversePair}
                >
                  <ArrowDownUp />
                </Button>
              </div>
              <div className="trade-asset-box">
                <p className="mb-3 flex justify-between gap-3 text-[11px] text-subtle">
                  <span>Estimated receive</span>
                  <span>{quote ? (secondsLeft === 0 ? 'Expired quote' : 'Current quote') : 'Quote required'}</span>
                </p>
                <div className="flex items-center gap-3">
                  <output
                    className="min-w-0 flex-1 overflow-wrap-anywhere font-mono text-[28px]"
                    aria-label="Estimated receive"
                  >
                    {quote && secondsLeft !== 0 ? quote.expectedOut.amount : '—'}
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
                <SwapProposalCard
                  key={intentId}
                  intentId={intentId}
                  onQuote={draft.setQuote}
                  onInteractionLock={setLocked}
                />
              ) : draft.waiting ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" /> Getting a live quote…
                </p>
              ) : draft.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {draft.error}
                </p>
              ) : (
                <p className="text-xs text-subtle">Enter an amount to get a live quote.</p>
              )}
              <ReviewRequirements />
            </div>
          )}
        </section>
        <section className="workspace-panel trade-positions" aria-labelledby="trade-positions-title">
          <h2 id="trade-positions-title" className="border-b px-6 py-5 font-serif text-xl font-semibold">
            Swap history
          </h2>
          <div className="px-5 pb-5">
            <WalletActivity />
          </div>
        </section>
      </div>
    </div>
  );
}
