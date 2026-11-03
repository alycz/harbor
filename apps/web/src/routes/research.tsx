import type { ProtocolRow, YieldPoolRow } from '@harbor/data/research';
import { Badge } from '@harbor/ui/components/badge';
import { Card, CardContent } from '@harbor/ui/components/card';
import { Input } from '@harbor/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@harbor/ui/components/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@harbor/ui/components/tabs';
import { useState } from 'react';

import { ProtocolLogo } from '../components/protocol-logo.tsx';
import { ResearchDataTable } from '../components/research-data-table.tsx';
import { EmptyState, PageHeader } from '../components/workspace.tsx';
import { formatPercentPoints, formatUsd, formatUtc } from '../lib/format.ts';
import { capturedAt, research, yieldChains } from '../lib/research.ts';

const ALL = 'all';

export function ResearchPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Research"
        kicker="Cross-chain venues"
        description="Compare yield venues and protocols across chains from a dated snapshot. Nothing here is a live rate or an executable quote."
      />
      <SnapshotNotice />
      <Tabs defaultValue="yields">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger className="min-h-11" value="yields">
            Yield pools
          </TabsTrigger>
          <TabsTrigger className="min-h-11" value="protocols">
            Protocols
          </TabsTrigger>
        </TabsList>
        <TabsContent value="yields">
          <YieldTable />
        </TabsContent>
        <TabsContent value="protocols">
          <ProtocolTable />
        </TabsContent>
      </Tabs>
      {research.caveats.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-xs text-subtle">
          {research.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SnapshotNotice() {
  const captured = capturedAt();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
      <Badge variant="outline">Dated snapshot</Badge>
      {captured ? <span>Captured {formatUtc(captured)}</span> : <span>No snapshot captured yet</span>}
      {research.sources.map((source) => (
        <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="hover:text-primary">
          Source: {source.attribution}
        </a>
      ))}
    </div>
  );
}

function YieldTable() {
  const [chain, setChain] = useState(ALL);
  const [query, setQuery] = useState('');
  const [stableOnly, setStableOnly] = useState(false);
  const rows = research.yieldPools
    .filter((pool) => chain === ALL || pool.chain === chain)
    .filter((pool) => !stableOnly || pool.stablecoin)
    .filter((pool) => `${pool.project} ${pool.symbol}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => (b.totalApyPct ?? -1) - (a.totalApyPct ?? -1));
  if (research.yieldPools.length === 0) return <EmptySnapshot />;
  return (
    <Card>
      <CardContent>
        <ResearchDataTable<YieldPoolRow>
          tableKey="research-yields"
          label="Yield pools"
          rows={rows}
          getRowId={(row) => row.id}
          controls={
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="search"
                aria-label="Search pools"
                placeholder="Search project or asset…"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                className="h-9 w-56"
              />
              <Select value={chain} onValueChange={(value) => setChain(typeof value === 'string' ? value : ALL)}>
                <SelectTrigger aria-label="Chain" className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All chains</SelectItem>
                  {yieldChains().map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={stableOnly}
                  onChange={(event) => setStableOnly(event.currentTarget.checked)}
                />
                Stablecoins only
              </label>
            </div>
          }
          columns={[
            {
              id: 'pool',
              label: 'Pool',
              required: true,
              cell: (row) => (
                <div>
                  <p className="font-medium">{row.symbol}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.project}
                    {row.meta ? ` · ${row.meta}` : ''}
                  </p>
                </div>
              ),
            },
            { id: 'chain', label: 'Chain', cell: (row) => row.chain },
            {
              id: 'apy',
              label: 'Total APY',
              numeric: true,
              cell: (row) => formatPercentPoints(row.totalApyPct),
            },
            { id: 'base', label: 'Base APY', numeric: true, cell: (row) => formatPercentPoints(row.baseApyPct) },
            {
              id: 'reward',
              label: 'Reward APY',
              numeric: true,
              cell: (row) => formatPercentPoints(row.rewardApyPct),
            },
            { id: 'tvl', label: 'TVL', numeric: true, cell: (row) => formatUsd(row.tvlUsd) },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function ProtocolTable() {
  const [query, setQuery] = useState('');
  const rows = research.protocols
    .filter((protocol) => `${protocol.name} ${protocol.category}`.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => (b.allChainsTvlUsd ?? -1) - (a.allChainsTvlUsd ?? -1));
  if (research.protocols.length === 0) return <EmptySnapshot />;
  return (
    <Card>
      <CardContent>
        <ResearchDataTable<ProtocolRow>
          tableKey="research-protocols"
          label="Protocols"
          rows={rows}
          getRowId={(row) => row.id}
          controls={
            <Input
              type="search"
              aria-label="Search protocols"
              placeholder="Search name or category…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              className="h-9 w-56"
            />
          }
          columns={[
            {
              id: 'protocol',
              label: 'Protocol',
              required: true,
              cell: (row) => (
                <div className="flex items-center gap-2">
                  <ProtocolLogo name={row.name} fallback={row.logo} className="size-6" />
                  <div>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.category}</p>
                  </div>
                </div>
              ),
            },
            { id: 'chains', label: 'Chains', cell: (row) => row.chains.slice(0, 4).join(', ') },
            { id: 'tvl', label: 'TVL, all chains', numeric: true, cell: (row) => formatUsd(row.allChainsTvlUsd) },
            { id: 'day', label: '1d', numeric: true, cell: (row) => formatPercentPoints(row.change.day) },
            { id: 'week', label: '7d', numeric: true, cell: (row) => formatPercentPoints(row.change.week) },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function EmptySnapshot() {
  return (
    <EmptyState
      title="No research snapshot yet"
      description="This build ships without captured market data. Rows appear once a dated snapshot is committed."
    />
  );
}
