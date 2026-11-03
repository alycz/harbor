import { Badge } from '@harbor/ui/components/badge';
import { Button } from '@harbor/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@harbor/ui/components/card';
import { Skeleton } from '@harbor/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Wallet } from 'lucide-react';

import { Fact } from '../components/swap-proposal.tsx';
import { WalletActivity } from '../components/trade-live.tsx';
import { EmptyState, PageHeader } from '../components/workspace.tsx';
import { execution, planProblem } from '../lib/execution.ts';
import { useHealth } from '../lib/health.ts';
import { shortAddress, useWallet } from '../lib/wallet.tsx';

export function PortfolioPage() {
  const wallet = useWallet();
  const health = useHealth();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Portfolio"
        kicker="Account"
        description="What Harbor has done for the connected account, from its own records. Every entry was signed in your wallet."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <WalletActivity />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            {wallet.address ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <Fact label="Account" value={shortAddress(wallet.address)} />
                <Fact label="Network" value={health.data?.network === 'testnet' ? 'Testnet' : 'Mainnet'} />
              </dl>
            ) : (
              <EmptyState title="No wallet connected" description="Connect a wallet to see its activity.">
                <Button onClick={wallet.connect} disabled={wallet.connecting}>
                  <Wallet /> {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
                </Button>
              </EmptyState>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** One plan as Harbor recorded it: the reviewed quote, the policy decision and where it stands. */
export function PlanStatusPage({ planId }: { planId: string }) {
  const plan = useQuery({ queryKey: ['plan', planId], queryFn: () => execution.read(planId), refetchInterval: 10_000 });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plan status"
        kicker="Activity"
        description="The reviewed plan, its policy decision and its lifecycle, from Harbor's records."
        actions={
          <Button nativeButton={false} variant="outline" render={<Link to="/portfolio" />}>
            Back to portfolio
          </Button>
        }
      />
      {plan.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : plan.isError ? (
        <EmptyState title="Plan not loaded" description={plan.error.message} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Swap {plan.data.quote.sell.symbol} → {plan.data.quote.expectedOut.symbol}
                <Badge variant="outline">{plan.data.status.replaceAll('_', ' ')}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <Fact label="You send" value={`${plan.data.quote.sell.amount} ${plan.data.quote.sell.symbol}`} />
                <Fact
                  label="At least"
                  value={`${plan.data.quote.minimumOut.amount} ${plan.data.quote.minimumOut.symbol}`}
                />
                <Fact label="Venue" value={plan.data.quote.venue} />
                <Fact label="Policy" value={plan.data.policy.verdict} />
              </dl>
              {plan.data.policy.reasons
                .filter((reason) => !reason.pass)
                .map((reason) => (
                  <p key={reason.code} className="text-xs text-muted-foreground">
                    {reason.detail}
                  </p>
                ))}
              {planProblem(plan.data) ? <p className="text-destructive">{planProblem(plan.data)}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Plan identity</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <Fact label="Plan" value={shortAddress(plan.data.id)} />
                <Fact label="Account" value={shortAddress(plan.data.account)} />
                <Fact label="Approved" value={plan.data.approvedAt ?? 'Not yet'} />
                <Fact label="Transaction" value={plan.data.txHash ? shortAddress(plan.data.txHash) : 'None'} />
              </dl>
              <p className="mt-4 break-all font-mono text-[11px] text-subtle">Digest {plan.data.digest}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
