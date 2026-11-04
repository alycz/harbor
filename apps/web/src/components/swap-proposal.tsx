import { Button } from '@harbor/ui/components/button';
import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ExecutionRequestError, execution, type Intent, type Plan, planProblem, type Quote } from '../lib/execution.ts';
import { formatTokenAmount, venueName } from '../lib/format.ts';
import { shortAddress, useWallet } from '../lib/wallet.tsx';
import { FactRow } from './brand.tsx';
import { FactRowsSkeleton } from './skeletons.tsx';

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
    <section aria-label="Swap proposal" className="border border-line bg-background text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <p className="flex items-center gap-2 font-medium">
          {sell ? `${formatTokenAmount(sell.amount)} ${sell.symbol}` : '…'} <ArrowRight className="size-4" />{' '}
          {buySymbol}
        </p>
        <p className="text-[11px] font-medium tracking-[0.6px] text-primary uppercase">
          {intent ? (intent.network === 'mainnet' ? 'Mainnet' : 'Testnet') : null}
          {quote ? ` · ${venueName(quote.venue)}` : null}
        </p>
      </div>

      <div className="space-y-3 p-4">
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
              value={`${formatTokenAmount(quote.expectedOut.amount)} ${quote.expectedOut.symbol}`}
              title={quote.expectedOut.amount}
            />
            <FactRow
              label={`At least (${quote.slippageBps / 100}% slippage)`}
              value={
                <span className="font-semibold text-primary">
                  {formatTokenAmount(quote.minimumOut.amount)} {quote.minimumOut.symbol}
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
          <div className="space-y-2 border-l-2 border-primary bg-secondary px-3 py-2.5">
            <p className="flex items-center gap-2 text-[11px] font-medium tracking-[0.6px] uppercase">
              <ShieldCheck className="size-3.5 text-primary" /> Policy check: {plan.policy.verdict}
            </p>
            {warnings.map((reason) => (
              <p key={reason.code} className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {reason.detail}
              </p>
            ))}
            <p className="break-all text-[11px] text-muted-foreground">Approval digest {plan.digest}</p>
          </div>
        ) : null}

        {phase === 'approved' ? (
          <p className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> Approved. Nothing has moved: the next step
            is your signature in your own wallet.
          </p>
        ) : null}

        {plan && phase === 'stopped' ? (
          <p className="text-destructive">{planProblem(plan) ?? 'This swap stopped.'}</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          {(phase === 'quoted' || phase === 'review') && expired ? (
            <Button variant="outline" className="h-11" onClick={() => requote()}>
              <RefreshCw /> New quote
            </Button>
          ) : null}
          {phase === 'stopped' ? (
            <Button variant="outline" className="h-11" onClick={() => requote()}>
              <RefreshCw /> Try again
            </Button>
          ) : null}
          {phase === 'quoted' && !expired && !wallet.address ? (
            <Button className="h-11" onClick={wallet.connect} disabled={wallet.connecting}>
              <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet to review'}
            </Button>
          ) : null}
          {phase === 'quoted' && !expired && wallet.address ? (
            <Button className="h-11" onClick={() => review()}>
              Review swap
            </Button>
          ) : null}
          {phase === 'planning' || phase === 'approving' ? (
            <Button className="h-11" disabled>
              <LoaderCircle className="animate-spin motion-reduce:animate-none" /> Checking the policy…
            </Button>
          ) : null}
          {phase === 'review' && !expired ? (
            <Button className="h-11" onClick={approve}>
              Approve these exact terms
            </Button>
          ) : null}
          {secondsLeft !== null && !expired ? (
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">Valid for {secondsLeft}s</span>
          ) : null}
        </div>
        {wallet.error ? <p className="text-xs text-destructive">{wallet.error}</p> : null}
      </div>
    </section>
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
