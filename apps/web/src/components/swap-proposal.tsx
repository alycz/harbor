import { Badge } from '@harbor/ui/components/badge';
import { Button } from '@harbor/ui/components/button';
import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ExecutionRequestError, execution, type Intent, type Plan, planProblem, type Quote } from '../lib/execution.ts';
import { shortAddress, useWallet } from '../lib/wallet.tsx';

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
    <section aria-label="Swap proposal" className="mt-3 space-y-3 rounded-lg border bg-background p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          {sell ? `${sell.amount} ${sell.symbol}` : '…'} <ArrowRight className="size-4" /> {buySymbol}
        </p>
        <div className="flex gap-1.5">
          {intent ? <Badge variant="outline">{intent.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</Badge> : null}
          {quote ? <Badge variant="secondary">{quote.venue}</Badge> : null}
        </div>
      </div>

      {phase === 'quoting' ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Getting a live quote…
        </p>
      ) : null}

      {quote && phase !== 'quoting' && phase !== 'stopped' ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <Fact label="Expected" value={`${quote.expectedOut.amount} ${quote.expectedOut.symbol}`} />
          <Fact
            label="At least"
            value={`${quote.minimumOut.amount} ${quote.minimumOut.symbol} (${quote.slippageBps / 100}% slippage)`}
          />
          <Fact
            label="Price impact"
            value={quote.priceImpactBps === null ? 'Not reported' : `${quote.priceImpactBps / 100}%`}
          />
          <Fact label="Route" value={quote.protocols.join(', ') || quote.venue} />
          <Fact label="Harbor fee" value="0" />
          {plan ? <Fact label="From" value={shortAddress(plan.account)} /> : null}
        </dl>
      ) : null}

      {plan && (phase === 'review' || phase === 'approving' || phase === 'approved') ? (
        <div className="space-y-1.5">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-subtle">
            <ShieldCheck className="size-3.5" /> Policy check: {plan.policy.verdict}
          </p>
          {warnings.map((reason) => (
            <p key={reason.code} className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="size-3.5 shrink-0" /> {reason.detail}
            </p>
          ))}
          <p className="break-all font-mono text-[11px] text-subtle">Approval digest {plan.digest}</p>
        </div>
      ) : null}

      {phase === 'approved' ? (
        <p className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-primary" /> Approved. Nothing has moved: the next step is your signature
          in your own wallet.
        </p>
      ) : null}

      {plan && phase === 'stopped' ? (
        <p className="text-destructive">{planProblem(plan) ?? 'This swap stopped.'}</p>
      ) : null}
      {error ? <p className="text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        {secondsLeft !== null && !expired ? (
          <span className="text-xs text-subtle">Valid for {secondsLeft}s</span>
        ) : null}
        {(phase === 'quoted' || phase === 'review') && expired ? (
          <Button variant="outline" size="sm" onClick={() => requote()}>
            <RefreshCw /> New quote
          </Button>
        ) : null}
        {phase === 'stopped' ? (
          <Button variant="outline" size="sm" onClick={() => requote()}>
            <RefreshCw /> Try again
          </Button>
        ) : null}
        {phase === 'quoted' && !expired && !wallet.address ? (
          <Button size="sm" onClick={wallet.connect} disabled={wallet.connecting}>
            <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet to review'}
          </Button>
        ) : null}
        {phase === 'quoted' && !expired && wallet.address ? (
          <Button size="sm" onClick={() => review()}>
            Review swap
          </Button>
        ) : null}
        {phase === 'planning' || phase === 'approving' ? (
          <Button size="sm" disabled>
            <LoaderCircle className="animate-spin" /> Checking the policy…
          </Button>
        ) : null}
        {phase === 'review' && !expired ? (
          <Button size="sm" onClick={approve}>
            Approve these exact terms
          </Button>
        ) : null}
      </div>
      {wallet.error ? <p className="text-xs text-destructive">{wallet.error}</p> : null}
    </section>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono tabular-nums">{value}</dd>
    </>
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
