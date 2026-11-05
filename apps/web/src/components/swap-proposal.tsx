import { Button } from '@harbor/ui/components/button';
import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ExecutionRequestError, execution, type Intent, type Plan, planProblem, type Quote } from '../lib/execution.ts';
import { formatTokenAmount, venueName } from '../lib/format.ts';
import { shortAddress, useWallet } from '../lib/wallet.tsx';
import { AssetIcon } from './asset-icon.tsx';
import { RollingNumber, RollText } from './motion.tsx';
import { FactRowsSkeleton } from './skeletons.tsx';
import { Chip, FactRow } from './workspace.tsx';

type Phase = 'quoting' | 'quoted' | 'planning' | 'review' | 'approving' | 'approved' | 'stopped';

/**
 * A swap proposal from chat or the Trade form. Everything shown comes from Harbor's own records: the
 * live quote, then the policy check and the digest the user approves. Nothing moves funds without the
 * user's signature in their own wallet. `onQuote` hears each quote (pass a stable function).
 */
export function SwapProposalCard({
  intentId,
  onQuote,
  onInteractionLock,
}: {
  intentId: string;
  onQuote?: (quote: Quote | null) => void;
  onInteractionLock?: (locked: boolean) => void;
}) {
  const wallet = useWallet();
  const [phase, setPhase] = useState<Phase>('quoting');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secondsLeft = useCountdown(phase === 'quoted' || phase === 'review' ? quote?.expiresAt : undefined);
  useEffect(() => {
    onInteractionLock?.(phase === 'planning' || phase === 'approving');
  }, [phase, onInteractionLock]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fail = useCallback((caught: unknown) => {
    setError(
      caught instanceof ExecutionRequestError || caught instanceof Error ? caught.message : 'Something went wrong.',
    );
  }, []);

  const requote = useCallback(async () => {
    setPhase('quoting');
    setError(null);
    setPlan(null);
    try {
      // The request itself always shows, even when no live quote can be had.
      setIntent(await execution.intent(intentId));
      const fresh = (await execution.quote(intentId)) ?? null;
      setQuote(fresh);
      if (mounted.current) onQuote?.(fresh);
      setPhase('quoted');
    } catch (caught) {
      fail(caught);
      onQuote?.(null);
      setPhase('stopped');
    }
  }, [intentId, fail, onQuote]);

  useEffect(() => {
    void requote();
  }, [requote]);

  async function review() {
    if (!quote || !wallet.address) return;
    setError(null);
    setPhase('planning');
    try {
      const created = await execution.plan({ intentId, quoteId: quote.id, accountId: wallet.address });
      setPlan(created);
      setPhase(created.status === 'awaiting_review' ? 'review' : 'stopped');
    } catch (caught) {
      fail(caught);
      setPhase('quoted');
    }
  }

  async function approve() {
    if (!plan) return;
    setError(null);
    setPhase('approving');
    try {
      const approved = await execution.approve(plan);
      setPlan(approved);
      setPhase(approved.status === 'awaiting_signature' ? 'approved' : 'stopped');
    } catch (caught) {
      fail(caught);
      setPhase('review');
    }
  }

  const sell = intent?.sell;
  const buySymbol = intent?.buy.symbol ?? quote?.expectedOut.symbol ?? '';
  const expired = secondsLeft !== null && secondsLeft <= 0;
  const warnings = plan?.policy.reasons.filter((reason) => !reason.pass && reason.severity === 'warn') ?? [];

  return (
    <section
      aria-label="Swap proposal"
      className="relative overflow-hidden rounded-xl border border-border bg-card text-[13.5px] shadow-[var(--ws-shadow-card)]"
    >
      {quote && (phase === 'quoted' || phase === 'review') ? (
        <QuoteTimer key={quote.expiresAt} until={quote.expiresAt} />
      ) : null}
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"
        title={quote ? `Through ${venueName(quote.venue)}` : undefined}
      >
        <p className="flex min-w-0 items-center gap-2.5 font-medium">
          {sell ? <AssetIcon symbol={sell.symbol} className="size-6" /> : null}
          <span className="ws-num">{sell ? `${formatTokenAmount(sell.amount)} ${sell.symbol}` : '…'}</span>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {buySymbol ? <AssetIcon symbol={buySymbol} className="size-6" /> : null}
          <span>{buySymbol}</span>
        </p>
        <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          {intent ? (
            <Chip tone={intent.network === 'mainnet' ? 'neutral' : 'warning'}>
              {intent.network === 'mainnet' ? 'Mainnet' : 'Testnet'}
            </Chip>
          ) : null}
        </span>
      </div>

      <div className="space-y-4 px-4 pt-2 pb-4">
        {phase === 'quoting' ? (
          <div role="status">
            <span className="sr-only">Getting a live quote</span>
            <FactRowsSkeleton rows={4} />
          </div>
        ) : null}

        {quote && phase !== 'quoting' && phase !== 'stopped' ? (
          <dl>
            <FactRow
              label="Expected"
              value={
                <>
                  <RollingNumber value={formatTokenAmount(quote.expectedOut.amount)} /> {quote.expectedOut.symbol}
                </>
              }
              title={quote.expectedOut.amount}
            />
            <FactRow
              label={`At least · ${quote.slippageBps / 100}% slippage`}
              value={
                <span className="text-[var(--ws-accent-ink)]">
                  <RollingNumber value={formatTokenAmount(quote.minimumOut.amount)} /> {quote.minimumOut.symbol}
                </span>
              }
              title={quote.minimumOut.amount}
            />
            <FactRow
              label="Price impact"
              value={quote.priceImpactBps === null ? 'Not reported' : `${quote.priceImpactBps / 100}%`}
            />
            <FactRow label="Harbor fee" value="None" />
            {plan ? <FactRow label="From" value={shortAddress(plan.account)} title={plan.account} /> : null}
          </dl>
        ) : null}

        {plan && (phase === 'review' || phase === 'approving' || phase === 'approved') ? (
          <div className="space-y-2 rounded-lg border border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] px-3.5 py-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-[var(--ws-accent-ink)]">
              <ShieldCheck className="size-4" aria-hidden="true" /> Policy check:{' '}
              <span className="capitalize">{plan.policy.verdict}</span>
            </p>
            {warnings.map((reason) => (
              <p key={reason.code} className="flex items-start gap-2 text-[12.5px] text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {reason.detail}
              </p>
            ))}
            <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
              Approval digest {plan.digest}
            </p>
          </div>
        ) : null}

        {phase === 'approved' ? (
          <p className="flex items-start gap-2.5 rounded-lg border border-success/20 bg-success/6 px-3.5 py-3 text-[13px]">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> Approved. Nothing has
            moved: the next step is your signature in your own wallet.
          </p>
        ) : null}

        {plan && phase === 'stopped' ? (
          <p className="text-destructive">{planProblem(plan) ?? 'This swap stopped.'}</p>
        ) : null}
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          {(phase === 'quoted' || phase === 'review') && expired ? (
            <Button variant="outline" className="h-10 gap-2" onClick={() => requote()}>
              <RefreshCw /> New quote
            </Button>
          ) : null}
          {phase === 'stopped' ? (
            <Button variant="outline" className="h-10 gap-2" onClick={() => requote()}>
              <RefreshCw /> Try again
            </Button>
          ) : null}
          {phase === 'quoted' && !expired && !wallet.address ? (
            <Button className="h-10 gap-2 px-4" onClick={wallet.connect} disabled={wallet.connecting}>
              <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet to review'}
            </Button>
          ) : null}
          {phase === 'quoted' && !expired && wallet.address ? (
            <Button className="h-10 px-4" onClick={() => review()}>
              Review swap
            </Button>
          ) : null}
          {phase === 'planning' || phase === 'approving' ? (
            <Button className="h-10 gap-2 px-4" disabled>
              <LoaderCircle className="animate-spin motion-reduce:animate-none" /> Checking the policy…
            </Button>
          ) : null}
          {phase === 'review' && !expired ? (
            <Button className="h-10 px-4" onClick={approve}>
              Approve these exact terms
            </Button>
          ) : null}
          {secondsLeft !== null ? (
            <span className="ml-auto text-[12.5px] text-muted-foreground">
              <RollText id={expired ? 'expired' : 'valid'}>
                {expired ? (
                  'Quote expired'
                ) : (
                  <span>
                    Valid for <RollingNumber value={String(secondsLeft)} className="font-medium text-foreground" />s
                  </span>
                )}
              </RollText>
            </span>
          ) : null}
        </div>
        {wallet.error ? <p className="text-[12.5px] text-destructive">{wallet.error}</p> : null}
      </div>
    </section>
  );
}

/** A hairline along the card's top edge that drains as the quote ages, then turns to the warning colour. */
function QuoteTimer({ until }: { until: string }) {
  const left = useCountdown(until) ?? 0;
  const [total] = useState(() => Math.max(1, Math.round((Date.parse(until) - Date.now()) / 1000)));
  const share = Math.max(0, Math.min(1, left / total));
  return (
    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-transparent">
      <span
        className={`block h-full origin-left transition-[scale,background-color] duration-1000 ease-linear motion-reduce:transition-none ${share < 0.2 ? 'bg-warning' : 'bg-primary/70'}`}
        style={{ scale: `${share} 1` }}
      />
    </span>
  );
}

export function useCountdown(until: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [until]);
  if (!until) return null;
  return Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
}
