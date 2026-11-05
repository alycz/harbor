import { Button } from '@harbor/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDashed,
  Clock3,
  FileSearch,
  History,
  LogOut,
  ShieldCheck,
  Wallet,
  WalletCards,
  X,
} from 'lucide-react';
import { Skeleton } from 'skullet/react';

import { ActivityShowcase } from '../components/activity-showcase.tsx';
import { AssetIcon } from '../components/asset-icon.tsx';
import { StatusTag, WalletActivity } from '../components/trade-live.tsx';
import { AccountDot, EmptyState, FactRow, PageHeader, Panel, Stat } from '../components/workspace.tsx';
import { execution, type Plan, planProblem } from '../lib/execution.ts';
import { formatTokenAmount, formatUtc, venueName } from '../lib/format.ts';
import { useHealth } from '../lib/health.ts';
import { SAMPLE_PLAN } from '../lib/samples.ts';
import { shortAddress, useWallet } from '../lib/wallet.tsx';

const WHAT_SHOWS = [
  { title: 'Swaps', detail: 'What you sent and what you received, with the transaction.', icon: WalletCards },
  { title: 'Pending', detail: 'Anything still waiting for the network to confirm.', icon: Clock3 },
  { title: 'History', detail: 'Every action Harbor took for you, refunds included.', icon: History },
] as const;

const SAMPLE_ADDRESS = 'harbor-sample-account.near';

export function PortfolioPage() {
  const wallet = useWallet();
  const health = useHealth();
  if (!wallet.address && !wallet.restoring) return <ConnectShowcase />;
  return (
    <div className="ws-stagger flex flex-col gap-6">
      <PageHeader
        title="Portfolio"
        description="What Harbor has done for the connected account, from its own records. Every entry was signed in your wallet."
      />
      <Skeleton loading={wallet.restoring} label="Loading your account" data={wallet.address} sample={SAMPLE_ADDRESS}>
        {(address) => (
          <section
            aria-labelledby="portfolio-account"
            className="ws-card flex flex-col gap-4 p-4 @3xl/workspace:flex-row @3xl/workspace:items-center @3xl/workspace:gap-8 @3xl/workspace:px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <AccountDot address={address} className="size-10" />
              <div className="min-w-0">
                <h2 id="portfolio-account" className="text-[14px] font-medium">
                  Connected account
                </h2>
                <p className="truncate text-[13px] text-muted-foreground" title={address}>
                  {shortAddress(address)}
                </p>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-4 border-t border-border pt-4 @3xl/workspace:flex-1 @3xl/workspace:border-t-0 @3xl/workspace:border-l @3xl/workspace:pt-0 @3xl/workspace:pl-8">
              <Stat label="Network" value={health.data?.network === 'testnet' ? 'Testnet' : 'Mainnet'} />
              <Stat label="Execution" value={health.data?.executionEnabled ? 'On' : 'Review only'} />
              <Stat label="Keys" value="In your wallet" />
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                nativeButton={false}
                variant="outline"
                className="h-9 flex-1 gap-2 px-3 @3xl/workspace:flex-none"
                render={<Link to="/settings/policy" />}
              >
                <ShieldCheck className="text-muted-foreground" /> Review policy
              </Button>
              <Button variant="ghost" className="h-9 gap-2 px-3 text-muted-foreground" onClick={wallet.disconnect}>
                <LogOut /> Disconnect
              </Button>
            </div>
          </section>
        )}
      </Skeleton>
      <Panel label="Activity" icon={<History />} labelId="portfolio-activity" bodyClassName="px-5 pb-1">
        <WalletActivity />
      </Panel>
    </div>
  );
}

/** No wallet yet: the ink hero, with a moving still of what will appear here once one is connected. */
function ConnectShowcase() {
  const wallet = useWallet();
  return (
    <div className="ws-stagger flex flex-col gap-5">
      <section className="ws-hero grid min-h-[420px] @3xl/workspace:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="flex flex-col justify-center px-6 py-10 @xl/workspace:px-10">
          <h1 className="font-display max-w-[16ch] text-[32px] leading-[1.1] text-band-foreground @xl/workspace:text-[38px]">
            Connect a wallet to see what Harbor did for it.
          </h1>
          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-[var(--ws-band-muted)]">
            Harbor reads its own records for the account you sign in with. It never asks for your keys; you approve each
            action in your wallet.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button className="h-11 gap-2 px-4 text-[14px]" onClick={wallet.connect} disabled={wallet.connecting}>
              <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
            </Button>
            <Link
              to="/trade"
              className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-[14px] font-medium text-[var(--ws-band-muted)] transition-colors hover:text-band-foreground"
            >
              Try a swap first <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          {wallet.error ? (
            <p
              role="alert"
              className="mt-4 max-w-md rounded-lg border border-white/10 bg-white/5 px-3.5 py-3 text-[13px] text-[#ffb4a8]"
            >
              {wallet.error}
            </p>
          ) : null}
        </div>
        <div className="relative hidden items-center py-10 pr-10 pl-4 @3xl/workspace:flex">
          <ActivityShowcase />
        </div>
      </section>
      <ul className="grid gap-3 @xl/workspace:grid-cols-3">
        {WHAT_SHOWS.map((item) => (
          <li key={item.title} className="ws-card flex gap-3.5 p-4">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-secondary/60 text-muted-foreground"
            >
              <item.icon className="size-4" />
            </span>
            <span>
              <span className="block text-[14px] font-medium">{item.title}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One plan as Harbor recorded it: the reviewed quote, the policy decision and where it stands. */
export function PlanStatusPage({ planId }: { planId: string }) {
  const plan = useQuery({ queryKey: ['plan', planId], queryFn: () => execution.read(planId), refetchInterval: 10_000 });
  return (
    <div className="ws-stagger flex flex-col gap-7">
      <PageHeader
        title="Plan status"
        description="The reviewed plan, its policy decision and its lifecycle, from Harbor's records."
        actions={
          <Button nativeButton={false} variant="outline" className="h-9 gap-2 px-3" render={<Link to="/portfolio" />}>
            <ArrowLeft /> Portfolio
          </Button>
        }
      />
      {plan.isError ? (
        <Panel>
          <EmptyState icon={<FileSearch />} title="This plan could not be loaded" description={plan.error.message} />
        </Panel>
      ) : (
        <Skeleton loading={plan.isPending} label="Loading plan" data={plan.data} sample={SAMPLE_PLAN}>
          {(data) => <PlanView plan={data} />}
        </Skeleton>
      )}
    </div>
  );
}

function PlanView({ plan }: { plan: Plan }) {
  const { quote } = plan;
  const problem = planProblem(plan);
  return (
    <div className="grid items-start gap-5 @3xl/workspace:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <section aria-labelledby="plan-title" className="ws-card">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 @xl/workspace:px-6">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex shrink-0 -space-x-2.5">
                <span className="rounded-full bg-card p-0.5">
                  <AssetIcon symbol={quote.sell.symbol} className="size-9" />
                </span>
                <span className="rounded-full bg-card p-0.5">
                  <AssetIcon symbol={quote.expectedOut.symbol} className="size-9" />
                </span>
              </span>
              <h2 id="plan-title" className="font-display text-[24px] leading-tight">
                Swap {quote.sell.symbol} to {quote.expectedOut.symbol}
              </h2>
            </div>
            <StatusTag status={plan.status} />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border px-5 py-4 @xl/workspace:grid-cols-4 @xl/workspace:px-6">
            <Stat
              label="You send"
              value={`${formatTokenAmount(quote.sell.amount)} ${quote.sell.symbol}`}
              title={quote.sell.amount}
            />
            <Stat
              label="At least"
              value={`${formatTokenAmount(quote.minimumOut.amount)} ${quote.minimumOut.symbol}`}
              title={quote.minimumOut.amount}
            />
            <Stat label="Through" value={venueName(quote.venue)} />
            <Stat label="Policy" value={<span className="capitalize">{plan.policy.verdict}</span>} />
          </dl>
          {plan.policy.reasons.some((reason) => !reason.pass) || problem ? (
            <div className="space-y-2 border-t border-border px-5 py-4 @xl/workspace:px-6">
              {plan.policy.reasons
                .filter((reason) => !reason.pass)
                .map((reason) => (
                  <p
                    key={reason.code}
                    className={`text-[13px] ${reason.severity === 'block' ? 'text-destructive' : 'text-warning'}`}
                  >
                    {reason.detail}
                  </p>
                ))}
              {problem ? <p className="text-[13px] text-destructive">{problem}</p> : null}
            </div>
          ) : null}
        </section>
        <Panel label="Lifecycle" icon={<Clock3 />} labelId="plan-lifecycle">
          <Lifecycle plan={plan} />
        </Panel>
      </div>
      <Panel label="Plan identity" labelId="plan-identity" bodyClassName="px-5 pt-1.5 pb-5">
        <dl>
          <FactRow label="Plan" value={shortAddress(plan.id)} title={plan.id} />
          <FactRow label="Account" value={shortAddress(plan.account)} title={plan.account} />
          <FactRow label="Approved" value={plan.approvedAt ? formatUtc(plan.approvedAt) : 'Not yet'} />
          <FactRow
            label="Transaction"
            value={
              plan.txHash && plan.explorerUrl ? (
                <a href={plan.explorerUrl} target="_blank" rel="noreferrer" className="ws-link">
                  {shortAddress(plan.txHash)}
                </a>
              ) : plan.txHash ? (
                shortAddress(plan.txHash)
              ) : (
                'None'
              )
            }
            {...(plan.txHash ? { title: plan.txHash } : {})}
          />
        </dl>
        <p className="mt-4 rounded-lg bg-secondary/60 px-3 py-2.5 font-mono text-[11px] leading-relaxed break-all text-muted-foreground">
          Digest {plan.digest}
        </p>
      </Panel>
    </div>
  );
}

const STEPS = [
  {
    label: 'Policy checked',
    reached: ['policy_checked', 'awaiting_review', 'awaiting_signature', 'submitted', 'confirming', 'confirmed'],
  },
  { label: 'Approved by you', reached: ['awaiting_signature', 'submitted', 'confirming', 'confirmed'] },
  { label: 'Signed and submitted', reached: ['submitted', 'confirming', 'confirmed'] },
  { label: 'Delivered and confirmed', reached: ['confirmed'] },
] as const;

const STOPPED: Partial<Record<Plan['status'], string>> = {
  blocked: 'Blocked by your policy',
  failed: 'Failed',
  refunded: 'Refunded: a refund is not a success',
  expired: 'Expired before it was used',
  outcome_unknown: 'Outcome unknown: checking delivery',
};

/** Where the plan stands, as a short vertical timeline: done, current, and what is still to come. */
function Lifecycle({ plan }: { plan: Plan }) {
  const stopped = STOPPED[plan.status];
  const reachedCount = STEPS.filter((step) => (step.reached as readonly string[]).includes(plan.status)).length;
  return (
    <ol className="relative">
      {STEPS.map((step, index) => {
        const done = index < reachedCount;
        const current = index === reachedCount && !stopped;
        return (
          <li key={step.label} className="relative flex gap-3.5 pb-5 last:pb-0">
            {index < STEPS.length - 1 || stopped ? (
              <span
                aria-hidden="true"
                className={`absolute top-6 bottom-0 left-[11px] w-px ${done ? 'bg-foreground/40' : 'bg-border'}`}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={`skullet-block relative z-[1] grid size-[23px] shrink-0 place-items-center rounded-full border ${done ? 'border-transparent bg-foreground text-background' : current ? 'border-primary bg-[var(--harbor-accent-tint)] text-primary' : 'border-border bg-card text-muted-foreground'}`}
            >
              {done ? (
                <Check className="size-3" strokeWidth={2.5} />
              ) : current ? (
                <CircleDashed className="size-3 animate-spin [animation-duration:3s] motion-reduce:animate-none" />
              ) : null}
            </span>
            <span
              className={`pt-0.5 text-[13.5px] ${done || current ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
            >
              {step.label}
              {current ? <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">Next</span> : null}
            </span>
          </li>
        );
      })}
      {stopped ? (
        <li className="relative flex gap-3.5">
          <span
            aria-hidden="true"
            className="relative z-[1] grid size-[23px] shrink-0 place-items-center rounded-full border border-destructive/30 bg-destructive/8 text-destructive"
          >
            <X className="size-3" strokeWidth={2.5} />
          </span>
          <span className="pt-0.5 text-[13.5px] font-medium text-destructive">{stopped}</span>
        </li>
      ) : null}
    </ol>
  );
}
