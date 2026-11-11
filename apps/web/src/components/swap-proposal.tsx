import { Button } from '@harbor/ui/components/button';
import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ExecutionRequestError, execution, type Intent, type Plan, planProblem, type Quote } from '../lib/execution.ts';
import { formatTokenAmount, venueName } from '../lib/format.ts';
import { shortAddress, useWallet, walletProblem } from '../lib/wallet.tsx';
import { AssetIcon } from './asset-icon.tsx';
import { RollingNumber, RollText } from './motion.tsx';
import { FactRowsSkeleton } from './skeletons.tsx';
import { Chip, FactRow } from './workspace.tsx';

type Phase =
  | 'quoting'
  | 'quoted'
  | 'setup'
  | 'settingUp'
  | 'planning'
  | 'review'
  | 'approving'
  | 'approved'
  | 'signing'
  | 'submitting'
  | 'tracking'
  | 'stopped';

const SETTLED = new Set(['confirmed', 'refunded', 'failed', 'outcome_unknown', 'expired', 'blocked']);

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
    onInteractionLock?.(
      phase === 'planning' ||
        phase === 'approving' ||
        phase === 'signing' ||
        phase === 'submitting' ||
        phase === 'settingUp',
    );
  }, [phase, onInteractionLock]);
  // Follows a sent swap until it settles: confirmed, refunded, failed or unknown.
  useEffect(() => {
    if (phase !== 'tracking' || !plan || SETTLED.has(plan.status)) return;
    const timer = setTimeout(() => {
      execution.read(plan.id).then(setPlan, () => undefined);
    }, 4_000);
    return () => clearTimeout(timer);
  }, [phase, plan]);
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
      const created = await execution.plan({ intentId, quoteId: quote.id });
      setPlan(created);
      // With execution on, the plan carries the executable quote: review exactly those terms.
      setQuote(created.quote);
      setPhase(created.status === 'awaiting_review' ? 'review' : 'stopped');
    } catch (caught) {
      if (caught instanceof ExecutionRequestError && caught.code === 'SETUP_REQUIRED') {
        setPhase('setup');
        return;
      }
      fail(caught);
      setPhase('quoted');
    }
  }

  /** Signs the one-time token registrations 1Click needs, then reviews the swap again. */
  async function setUpAccount() {
    setError(null);
    setPhase('settingUp');
    try {
      const { transactions } = await execution.setup(intentId);
      for (const transaction of transactions) await wallet.sendTransaction(transaction);
      await review();
    } catch (caught) {
      const message = walletProblem(caught);
      if (message) setError(message);
      setPhase('setup');
    }
  }

  /** Approves the reviewed terms, then asks the wallet to sign the one deposit transaction. */
  async function approveAndSign() {
    if (!plan) return;
    setError(null);
    let current = plan;
    try {
      if (current.status === 'awaiting_review') {
        setPhase('approving');
        current = await execution.approve(current);
        setPlan(current);
      }
      if (current.status !== 'awaiting_signature' || !current.signing) {
        setPhase('stopped');
        return;
      }
      setPhase('signing');
      const hash = await wallet.sendTransaction(current.signing);
      setPhase('submitting');
      current = await execution.deposit(current.id, hash);
      setPlan(current);
      setPhase('tracking');
    } catch (caught) {
      const message = walletProblem(caught);
      if (message) setError(message);
      setPhase(current.status === 'awaiting_signature' ? 'approved' : 'review');
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

        {intent?.recipient && intent.recipient !== wallet.address ? (
          <p className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/8 px-3.5 py-2.5 text-[12.5px] text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              This asks to deliver to <span className="font-mono">{intent.recipient}</span>, which is not your signed-in
              account. Harbor blocks it unless it is an address you signed in your policy.
            </span>
          </p>
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
            {plan?.recipient ? (
              <FactRow
                label="Delivered to"
                value={`${shortAddress(plan.recipient.address)}${plan.recipient.chain === 'near' ? '' : ` on ${plan.recipient.chain}`}`}
                title={plan.recipient.address}
              />
            ) : null}
          </dl>
        ) : null}

        {plan && (phase === 'review' || phase === 'approving' || phase === 'approved') ? (
          <div className="space-y-2 rounded-lg border border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] px-3.5 py-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-[var(--ws-accent-ink)]">
              <ShieldCheck className="size-4" aria-hidden="true" /> Plan checks:{' '}
              <span className="capitalize">{plan.policy.verdict}</span>
            </p>
            {warnings.map((reason) => (
              <p key={reason.code} className="flex items-start gap-2 text-[12.5px] text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {reason.detail}
              </p>
            ))}
            <SignedPolicyCheck plan={plan} />
            <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
              Approval digest {plan.digest}
            </p>
          </div>
        ) : null}
        {plan && phase === 'stopped' ? <SignedPolicyCheck plan={plan} /> : null}

        {phase === 'approved' ? (
          <p className="flex items-start gap-2.5 rounded-lg border border-success/20 bg-success/6 px-3.5 py-3 text-[13px]">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" /> Approved. Nothing has
            moved: sign the deposit in your wallet to start the swap.
          </p>
        ) : null}
        {plan && phase === 'tracking' ? <SwapProgress plan={plan} /> : null}
        {phase === 'setup' || phase === 'settingUp' ? (
          <p className="rounded-lg border border-border bg-secondary/40 px-3.5 py-3 text-[13px] leading-relaxed">
            One-time setup: your account needs to be registered on these tokens before NEAR Intents can deliver to it or
            refund it. Your wallet asks for a small storage deposit per token, which stays yours.
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
          {phase === 'planning' || phase === 'approving' || phase === 'signing' || phase === 'submitting' ? (
            <Button className="h-10 gap-2 px-4" disabled>
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              {phase === 'signing'
                ? 'Confirm in your wallet…'
                : phase === 'submitting'
                  ? 'Checking the deposit on NEAR…'
                  : 'Checking the policy…'}
            </Button>
          ) : null}
          {phase === 'review' && !expired ? (
            <Button className="h-10 px-4" onClick={approveAndSign}>
              Approve and sign in wallet
            </Button>
          ) : null}
          {phase === 'approved' ? (
            <Button className="h-10 gap-2 px-4" onClick={approveAndSign}>
              <Wallet /> Sign the deposit
            </Button>
          ) : null}
          {phase === 'setup' ? (
            <Button className="h-10 gap-2 px-4" onClick={setUpAccount}>
              <Wallet /> Set up in wallet
            </Button>
          ) : null}
          {phase === 'settingUp' ? (
            <Button className="h-10 gap-2 px-4" disabled>
              <LoaderCircle className="animate-spin motion-reduce:animate-none" /> Confirm in your wallet…
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

const PROGRESS: Record<string, { label: string; tone: 'accent' | 'success' | 'warning' | 'danger' }> = {
  awaiting_signature: { label: 'Deposit sent, waiting for NEAR to show it', tone: 'accent' },
  submitted: { label: 'Deposit verified on NEAR', tone: 'accent' },
  confirming: { label: 'Swapping through NEAR Intents', tone: 'accent' },
  confirmed: { label: 'Delivered and verified on chain', tone: 'success' },
  refunded: { label: 'Refunded to your account: the swap did not happen', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  outcome_unknown: { label: 'Outcome not known yet', tone: 'warning' },
};

/** Where a sent swap stands, from Harbor's own records, with the receipts to check it. */
function SwapProgress({ plan }: { plan: Plan }) {
  const step = PROGRESS[plan.status] ?? { label: plan.status, tone: 'accent' as const };
  const settled = SETTLED.has(plan.status);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-secondary/40 px-3.5 py-3 text-[13px]">
      <p className="flex items-center gap-2 font-medium">
        {settled ? null : (
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        )}
        <Chip tone={step.tone} dot>
          {step.label}
        </Chip>
      </p>
      {planProblem(plan) ? <p className="text-muted-foreground">{planProblem(plan)}</p> : null}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
        {plan.explorerUrl ? (
          <a href={plan.explorerUrl} target="_blank" rel="noreferrer" className="ws-link">
            Deposit transaction
          </a>
        ) : null}
        <a href={`/plans/${plan.id}`} className="ws-link">
          Full receipt
        </a>
      </p>
    </div>
  );
}

/**
 * What the owner's signed policy says about this plan. Inside it, the agent could act alone; outside it,
 * only the owner's own approval moves it forward.
 */
export function SignedPolicyCheck({ plan }: { plan: Pick<Plan, 'policyCheck'> }) {
  const check = plan.policyCheck;
  if (!check) return null;
  const failed = check.reasons.filter((reason) => !reason.pass);
  if (check.verdict !== 'block') {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-success">
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" /> Within your signed policy.
      </p>
    );
  }
  return (
    <div className="space-y-1 text-[12.5px]">
      <p className="flex items-center gap-2 font-medium text-warning">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        {failed.some((reason) => reason.code === 'NO_POLICY')
          ? 'No signed policy: you approve every action yourself.'
          : 'Outside your signed policy: only you can approve this.'}
      </p>
      {failed
        .filter((reason) => reason.code !== 'NO_POLICY')
        .map((reason) => (
          <p key={reason.code} className="pl-5.5 text-muted-foreground">
            {reason.detail}
          </p>
        ))}
    </div>
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
