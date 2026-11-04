import { Button } from '@harbor/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Wallet } from 'lucide-react';

import { Band, Eyebrow, FactRow, Panel } from '../components/brand.tsx';
import { PlanSkeleton, PortfolioSkeleton } from '../components/skeletons.tsx';
import { StatusTag, WalletActivity } from '../components/trade-live.tsx';
import { EmptyState, PageHeader } from '../components/workspace.tsx';
import { execution, planProblem } from '../lib/execution.ts';
import { formatTokenAmount, formatUtc, venueName } from '../lib/format.ts';
import { useHealth } from '../lib/health.ts';
import { shortAddress, useWallet } from '../lib/wallet.tsx';

const WHAT_SHOWS = [
  { title: 'Swaps', detail: 'What you sent and what you received, with the transaction.' },
  { title: 'Pending', detail: 'Anything still waiting for the network to confirm.' },
  { title: 'History', detail: 'Every action Harbor took for you, refunds included.' },
] as const;

export function PortfolioPage() {
  const wallet = useWallet();
  const health = useHealth();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Portfolio"
        kicker="Account"
        description="What Harbor has done for the connected account, from its own records. Every entry was signed in your wallet."
      />
      {wallet.restoring ? (
        <PortfolioSkeleton header={false} />
      ) : wallet.address ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel label="Activity" labelId="portfolio-activity">
            <WalletActivity />
          </Panel>
          <Panel label="Account" aside="Connected" labelId="portfolio-account">
            <dl>
              <FactRow label="Account" value={shortAddress(wallet.address)} title={wallet.address} />
              <FactRow label="Network" value={health.data?.network === 'testnet' ? 'Testnet' : 'Mainnet'} />
              <FactRow label="Execution" value={health.data?.executionEnabled ? 'On' : 'Off on this server'} />
            </dl>
            <div className="mt-5 flex flex-col gap-2">
              <Button
                nativeButton={false}
                variant="outline"
                className="h-11 justify-between"
                render={<Link to="/settings/policy" />}
              >
                Review your policy <ArrowRight />
              </Button>
              <Button variant="ghost" className="h-11 justify-start text-muted-foreground" onClick={wallet.disconnect}>
                Disconnect
              </Button>
            </div>
          </Panel>
        </div>
      ) : (
        <Band className="border border-band">
          <div className="grid gap-10 p-8 sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <Eyebrow onBand>No wallet connected</Eyebrow>
              <h2 className="text-[clamp(30px,3.4vw,45px)] leading-none tracking-[-1px] uppercase">
                Connect a wallet to see <span className="text-sky">what Harbor did for it.</span>
              </h2>
              <p className="mt-6 max-w-[520px] text-sm leading-relaxed opacity-80">
                Harbor reads its own records for the account you sign in with. It never asks for your keys; you approve
                each action in your wallet.
              </p>
              <Button
                className="mt-8 h-14 justify-between gap-8 px-[22px] text-sm hover:shadow-[4px_4px_0_var(--harbor-band-text)]"
                onClick={wallet.connect}
                disabled={wallet.connecting}
              >
                <span className="flex items-center gap-2">
                  <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
                </span>
                <ArrowRight />
              </Button>
              {wallet.error ? (
                <p role="alert" className="mt-4 border-l-2 border-destructive pl-3 text-sm">
                  {wallet.error}
                </p>
              ) : null}
            </div>
            <ul className="border-t border-band-foreground/20">
              {WHAT_SHOWS.map((item) => (
                <li key={item.title} className="border-b border-band-foreground/20 py-4">
                  <p className="text-[11px] font-medium tracking-[0.6px] text-sky uppercase">{item.title}</p>
                  <p className="mt-1 text-sm opacity-80">{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </Band>
      )}
    </div>
  );
}

/** One plan as Harbor recorded it: the reviewed quote, the policy decision and where it stands. */
export function PlanStatusPage({ planId }: { planId: string }) {
  const plan = useQuery({ queryKey: ['plan', planId], queryFn: () => execution.read(planId), refetchInterval: 10_000 });
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Plan status"
        kicker="Activity"
        description="The reviewed plan, its policy decision and its lifecycle, from Harbor's records."
        actions={
          <Button nativeButton={false} variant="outline" className="h-11" render={<Link to="/portfolio" />}>
            <ArrowLeft /> Back to portfolio
          </Button>
        }
      />
      {plan.isPending ? (
        <PlanSkeleton header={false} />
      ) : plan.isError ? (
        <Panel label="Plan">
          <EmptyState title="This plan could not be loaded" description={plan.error.message} />
        </Panel>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel
            label={`Swap ${plan.data.quote.sell.symbol} to ${plan.data.quote.expectedOut.symbol}`}
            aside={<StatusTag status={plan.data.status} />}
          >
            <dl>
              <FactRow
                label="You send"
                value={`${formatTokenAmount(plan.data.quote.sell.amount)} ${plan.data.quote.sell.symbol}`}
                title={plan.data.quote.sell.amount}
              />
              <FactRow
                label="At least"
                value={`${formatTokenAmount(plan.data.quote.minimumOut.amount)} ${plan.data.quote.minimumOut.symbol}`}
                title={plan.data.quote.minimumOut.amount}
              />
              <FactRow label="Through" value={venueName(plan.data.quote.venue)} />
              <FactRow label="Policy check" value={plan.data.policy.verdict} />
            </dl>
            {plan.data.policy.reasons
              .filter((reason) => !reason.pass)
              .map((reason) => (
                <p key={reason.code} className="mt-3 border-l-2 border-primary pl-3 text-xs text-muted-foreground">
                  {reason.detail}
                </p>
              ))}
            {planProblem(plan.data) ? <p className="mt-4 text-sm text-destructive">{planProblem(plan.data)}</p> : null}
          </Panel>
          <Panel label="Plan identity">
            <dl>
              <FactRow label="Plan" value={shortAddress(plan.data.id)} title={plan.data.id} />
              <FactRow label="Account" value={shortAddress(plan.data.account)} title={plan.data.account} />
              <FactRow label="Approved" value={plan.data.approvedAt ? formatUtc(plan.data.approvedAt) : 'Not yet'} />
              <FactRow
                label="Transaction"
                value={plan.data.txHash ? shortAddress(plan.data.txHash) : 'None'}
                {...(plan.data.txHash ? { title: plan.data.txHash } : {})}
              />
            </dl>
            <p className="mt-4 text-[11px] break-all text-muted-foreground">Digest {plan.data.digest}</p>
          </Panel>
        </div>
      )}
    </div>
  );
}
