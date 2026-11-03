import type { YieldPoolRow } from '@harbor/data/research';
import { Badge } from '@harbor/ui/components/badge';
import { Button } from '@harbor/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@harbor/ui/components/card';
import { Link } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';

import { EmptyState, PageHeader } from '../components/workspace.tsx';
import { formatPercentPoints, formatUsd } from '../lib/format.ts';
import { research } from '../lib/research.ts';
import { SnapshotNotice } from './research.tsx';

/** Pools below this size are left out: their rates move too much to plan around. */
const MIN_TVL_USD = 1_000_000;

export function EarnPage() {
  const best = bestStablePoolPerChain(research.yieldPools);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Earn"
        kicker="Park idle stablecoins"
        description="Where idle stablecoins earned the most on each chain in the dated snapshot. Ask Harbor to compare venues for your amount; you sign anything it proposes."
        actions={
          <Button
            nativeButton={false}
            render={<Link to="/chat" search={{ ask: 'Where should I park 100 USDC across chains, and why?' }} />}
          >
            <MessageSquare /> Ask Harbor
          </Button>
        }
      />
      <SnapshotNotice />
      {best.length === 0 ? (
        <Card>
          <EmptyState
            title="No stablecoin pools in the snapshot"
            description="Stablecoin yields appear here once a dated research snapshot is committed."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {best.map((pool) => (
            <Card key={pool.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {pool.chain}
                  <Badge variant="outline">{pool.symbol}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-mono text-3xl tabular-nums">{formatPercentPoints(pool.totalApyPct)}</p>
                <p className="text-muted-foreground">
                  {pool.project}
                  {pool.meta ? ` · ${pool.meta}` : ''} · TVL {formatUsd(pool.tvlUsd)}
                </p>
                <p className="text-xs text-subtle">
                  Base {formatPercentPoints(pool.baseApyPct)} · rewards {formatPercentPoints(pool.rewardApyPct)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** The highest-APY stablecoin pool on each chain, among pools large enough to plan around. */
function bestStablePoolPerChain(pools: readonly YieldPoolRow[]): YieldPoolRow[] {
  const best = new Map<string, YieldPoolRow>();
  for (const pool of pools) {
    if (!pool.stablecoin || pool.totalApyPct === null || (pool.tvlUsd ?? 0) < MIN_TVL_USD) continue;
    const current = best.get(pool.chain);
    if (!current || (current.totalApyPct ?? -1) < pool.totalApyPct) best.set(pool.chain, pool);
  }
  return [...best.values()].sort((a, b) => (b.totalApyPct ?? -1) - (a.totalApyPct ?? -1));
}
