import { Button } from '@harbor/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@harbor/ui/components/dialog';
import { Input } from '@harbor/ui/components/input';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, CircleAlert, CircleCheck, LoaderCircle, Wallet } from 'lucide-react';
import { useId, useState } from 'react';

import { ExecutionRequestError } from '../lib/execution.ts';
import { formatApy, formatTokenAmount } from '../lib/format.ts';
import { fromRaw, fromYocto, lending, type RheaSymbol, type SupplyPlan } from '../lib/lending.ts';
import { projectLogo } from '../lib/research-view.ts';
import { useWallet, walletProblem } from '../lib/wallet.tsx';
import { chainLogoUrl, LogoPair } from './protocol-logo.tsx';
import { FactRow } from './workspace.tsx';

const SETTLE_ATTEMPTS = 30;
const SETTLE_INTERVAL_MS = 2_000;

type Phase =
  | { kind: 'form' }
  | { kind: 'registering' }
  | { kind: 'review'; plan: SupplyPlan }
  /** Approved; the wallet has not signed yet (or its window was closed). */
  | { kind: 'sign'; plan: SupplyPlan }
  | { kind: 'signing'; plan: SupplyPlan }
  /** Sent. `stalled` once Harbor stopped polling; checking again never sends anything. */
  | { kind: 'verifying'; plan: SupplyPlan; txHash: string; stalled: boolean }
  | { kind: 'done'; plan: SupplyPlan };

/**
 * Supplies a NEAR token to Rhea Lend from the owner's own wallet: one-time registration if Rhea has
 * not seen the account, then review, one wallet signature, and a result Harbor read from the chain.
 */
export function RheaDepositFlow({ symbol, initialAmount = '' }: { symbol: RheaSymbol; initialAmount?: string }) {
  const id = useId();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(initialAmount);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [error, setError] = useState<string | null>(null);
  const account = useQuery({
    queryKey: ['rhea-account', wallet.address, symbol],
    queryFn: () => lending.account(symbol),
    enabled: Boolean(wallet.address),
  });

  if (!wallet.address) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13.5px] text-muted-foreground">Connect the NEAR wallet that holds your {symbol}.</p>
        <Button className="h-10 gap-2 px-4" onClick={wallet.connect} disabled={wallet.connecting}>
          <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
        </Button>
      </div>
    );
  }
  if (account.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> Reading your balance and Rhea's
        market…
      </p>
    );
  }
  if (account.isError || !account.data) {
    return (
      <Problem>
        {account.error instanceof ExecutionRequestError ? account.error.message : 'Rhea could not be read just now.'}{' '}
        <button type="button" className="ws-link" onClick={() => account.refetch()}>
          Try again
        </button>
      </Problem>
    );
  }

  const data = account.data;
  const decimals = data.market.decimals;
  const balance = fromRaw(data.balanceRaw, decimals);
  const supplied = fromRaw(data.suppliedRaw, decimals);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rhea-account', wallet.address, symbol] });

  function fail(caught: unknown) {
    const message = walletProblem(caught);
    if (message) setError(message);
  }

  async function register() {
    if (!data.registration) return;
    setError(null);
    setPhase({ kind: 'registering' });
    try {
      await wallet.sendTransaction(data.registration.call);
      await refresh();
    } catch (caught) {
      fail(caught);
    } finally {
      setPhase({ kind: 'form' });
    }
  }

  async function review() {
    setError(null);
    try {
      setPhase({ kind: 'review', plan: await lending.create({ asset: symbol, amount }) });
    } catch (caught) {
      fail(caught);
    }
  }

  async function approveAndSign(plan: SupplyPlan) {
    setError(null);
    let current = plan;
    try {
      if (current.status === 'awaiting_review') current = await lending.approve(current);
      if (!current.signing) throw new ExecutionRequestError('This deposit is not ready to sign. Start again.');
      setPhase({ kind: 'signing', plan: current });
      const txHash = await wallet.sendTransaction(current.signing);
      await settle(current, txHash);
    } catch (caught) {
      fail(caught);
      setPhase(
        current.status === 'awaiting_signature' ? { kind: 'sign', plan: current } : { kind: 'review', plan: current },
      );
    }
  }

  /** Asks Harbor to check the chain until the transaction settles, about a minute at most. */
  async function settle(plan: SupplyPlan, txHash: string) {
    setError(null);
    setPhase({ kind: 'verifying', plan, txHash, stalled: false });
    try {
      for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
        const result = await lending.submit(plan.id, txHash);
        if (result.verification === 'settled') {
          setPhase({ kind: 'done', plan: result });
          await refresh();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, SETTLE_INTERVAL_MS));
      }
      setError('The transaction is still confirming. Check again in a minute; nothing will be sent twice.');
    } catch (caught) {
      setError(caught instanceof ExecutionRequestError ? caught.message : 'Harbor could not check the chain just now.');
    }
    setPhase({ kind: 'verifying', plan, txHash, stalled: true });
  }

  async function back(plan: SupplyPlan) {
    setError(null);
    setPhase({ kind: 'form' });
    await lending.cancel(plan.id).catch(() => undefined);
  }

  if (phase.kind === 'done') return <Outcome plan={phase.plan} onAgain={() => setPhase({ kind: 'form' })} />;

  if (phase.kind === 'review' || phase.kind === 'sign' || phase.kind === 'signing' || phase.kind === 'verifying') {
    const plan = phase.plan;
    const busy = phase.kind === 'signing' || (phase.kind === 'verifying' && !phase.stalled);
    return (
      <div className="flex flex-col gap-4">
        <dl className="rounded-[10px] border border-border bg-card px-4 py-1">
          <FactRow
            label="You supply"
            value={`${formatTokenAmount(fromRaw(plan.amountRaw, plan.decimals))} ${symbol}`}
          />
          <FactRow label="Into" value="Rhea Lend, your own account" />
          <FactRow label="Supply APR now" value={formatApy(data.market.supplyAprPct)} />
          <FactRow label="Used as collateral" value="No, so it cannot be liquidated" />
          <FactRow label="Withdraw" value="Any time Rhea has liquidity" />
        </dl>
        {phase.kind === 'verifying' && !phase.stalled ? (
          <p role="status" className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> Checking the deposit on chain…
          </p>
        ) : null}
        {error ? <Problem>{error}</Problem> : null}
        <div className="flex flex-wrap items-center gap-2.5">
          {phase.kind === 'verifying' ? (
            <Button className="h-11 gap-2 px-4" onClick={() => settle(plan, phase.txHash)} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
              {busy ? 'Confirming…' : 'Check again'}
            </Button>
          ) : (
            <Button className="h-11 gap-2 px-4" onClick={() => approveAndSign(plan)} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
              {phase.kind === 'signing'
                ? 'Confirm in your wallet…'
                : phase.kind === 'sign'
                  ? 'Sign in wallet'
                  : 'Approve and sign'}
            </Button>
          )}
          {phase.kind === 'review' ? (
            <Button variant="ghost" className="h-11 px-3" onClick={() => back(plan)}>
              Back
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!data.registered && data.registration) {
    return (
      <div className="flex flex-col gap-3.5">
        <div className="rounded-[10px] border border-border bg-card p-4">
          <p className="text-[14px] font-medium">One-time setup</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Rhea needs your account registered before your first deposit. Your wallet sends{' '}
            {formatTokenAmount(fromYocto(data.registration.depositYocto), 4)} NEAR for the storage your position uses.
          </p>
        </div>
        {error ? <Problem>{error}</Problem> : null}
        <Button
          className="h-11 gap-2 self-start px-4"
          onClick={register}
          disabled={phase.kind === 'registering' || !data.executionEnabled}
        >
          {phase.kind === 'registering' ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
          {phase.kind === 'registering' ? 'Confirm in your wallet…' : 'Register with Rhea'}
        </Button>
      </div>
    );
  }

  const exceeds = Number(amount) > Number(balance);
  const ready = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && !exceeds;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`${id}-amount`} className="text-[12.5px] font-medium text-muted-foreground">
          Amount
        </label>
        <button
          type="button"
          className="ws-num text-[12.5px] text-muted-foreground hover:text-foreground"
          onClick={() => setAmount(balance)}
        >
          Balance {formatTokenAmount(balance)} {symbol} · <span className="text-[var(--ws-accent-ink)]">Max</span>
        </button>
      </div>
      <div className="flex items-stretch gap-2.5">
        <div className="relative min-w-0 flex-1">
          <Input
            id={`${id}-amount`}
            className="h-11 pr-16 text-[15px]"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            aria-invalid={exceeds || undefined}
            onChange={(event) => setAmount(event.target.value.trim())}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[13px] text-muted-foreground">
            {symbol}
          </span>
        </div>
        <Button className="h-11 gap-2 px-4" onClick={review} disabled={!ready || !data.executionEnabled}>
          Review <ArrowRight />
        </Button>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        {exceeds
          ? `You have ${formatTokenAmount(balance)} ${symbol} on NEAR.`
          : Number(supplied) > 0
            ? `You already supply ${formatTokenAmount(supplied)} ${symbol} on Rhea.`
            : `${symbol} on NEAR, from your connected wallet.`}
      </p>
      {!data.executionEnabled ? <Problem>Rhea deposits are switched off on this server right now.</Problem> : null}
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

function Outcome({ plan, onAgain }: { plan: SupplyPlan; onAgain: () => void }) {
  const amount = `${formatTokenAmount(fromRaw(plan.amountRaw, plan.decimals))} ${plan.symbol}`;
  const confirmed = plan.status === 'confirmed';
  return (
    <div className="flex flex-col gap-3.5">
      <div
        className={`flex items-start gap-3 rounded-[10px] border p-4 ${confirmed ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}
      >
        {confirmed ? (
          <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        )}
        <div>
          <p className="text-[14px] font-medium">
            {confirmed
              ? `${amount} supplied to Rhea`
              : plan.status === 'refunded'
                ? `Rhea returned your ${plan.symbol}`
                : 'The deposit did not go through'}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {confirmed
              ? 'Harbor checked it on chain. It earns Rhea’s supply rate from now on.'
              : 'Nothing stayed with Rhea. Your tokens are back in your wallet, minus the network fee.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {plan.explorerUrl ? (
          <a
            href={plan.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ws-accent-ink)] hover:underline"
          >
            View on NEARBlocks <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
        <button
          type="button"
          className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
          onClick={onAgain}
        >
          Make another deposit
        </button>
      </div>
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[12.5px] text-destructive">
      {children}
    </p>
  );
}

/** Rhea Lend's deposit, in the same dialog frame as the vault deposits. */
export function RheaDepositDialog({
  symbol,
  aprPct,
  onOpenChange,
}: {
  symbol: RheaSymbol | null;
  aprPct: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={symbol !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] gap-0 p-0">
        {symbol ? (
          <>
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-center gap-3.5 pr-8">
                <LogoPair
                  className="size-10"
                  primary={{ name: 'Rhea Lend', url: projectLogo('rhea-lend') }}
                  secondary={{ name: 'NEAR', url: chainLogoUrl('NEAR') }}
                />
                <div className="min-w-0">
                  <DialogTitle className="font-display text-[22px] leading-tight">Rhea Lend</DialogTitle>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {symbol} on NEAR{aprPct === null ? '' : ` · ${formatApy(aprPct)} APR now`}
                  </p>
                </div>
              </div>
              <DialogDescription className="mt-4 text-[13.5px] leading-relaxed">
                Supply {symbol} from your NEAR wallet to Rhea and earn its supply rate. It stays in your own Rhea
                account, is never used as collateral, and you can withdraw on Rhea any time it has liquidity.
              </DialogDescription>
            </div>
            <div className="border-t border-border px-6 pt-5 pb-6">
              <RheaDepositFlow symbol={symbol} />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
