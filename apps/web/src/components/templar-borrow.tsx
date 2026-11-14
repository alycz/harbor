import { Button } from '@harbor/ui/components/button';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { call } from '../lib/execution.ts';
import { TemplarMarketDetails, useTemplarMarket } from './templar-chat-action.tsx';
import { Panel } from './workspace.tsx';

/** Credit discovery belongs on Earn; transaction review happens in Chat. */
export function TemplarBorrow() {
  const [markets, setMarkets] = useState<string[]>([]);
  const [offset, setOffset] = useState<number | null>(0);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { market, error: detailError } = useTemplarMarket(selected);
  async function load() {
    setBusy(true);
    setError('');
    try {
      const page = await call<{ markets: string[]; nextOffset?: number | null }>(
        `/api/templar/markets?offset=${offset ?? 0}`,
      );
      setMarkets((prior) => [...new Set([...prior, ...page.markets])]);
      setOffset(page.nextOffset ?? null);
    } catch {
      setError('Templar registry is unavailable. No sample markets or rates are shown.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel label="Templar credit markets" bodyClassName="space-y-3 p-5">
      <p className="text-sm text-muted-foreground">
        Discover real collateralized borrowing markets on NEAR. These are credit opportunities, not deposit yields.
        Research in Chat before queuing a transaction.
      </p>
      <Button disabled={busy || offset === null} onClick={load}>
        {busy ? 'Loading registry…' : markets.length ? 'Load more markets' : 'Discover markets'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      <label className="block text-sm">
        Registry market
        <select
          className="block w-full rounded border p-2"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a market to research</option>
          {markets.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      {selected && !market && !detailError ? <p className="text-sm">Reading finalized market configuration…</p> : null}
      {detailError ? <p role="alert">{detailError}</p> : null}
      {market ? (
        <div className="space-y-3">
          <TemplarMarketDetails market={market} />
          <Button
            nativeButton={false}
            render={
              <Link
                to="/chat"
                search={{
                  ask: `Research Templar credit market ${market.marketId} on NEAR mainnet. Verify its current configuration, borrow asset, collateral requirements, rates, liquidity, liquidation risk and whether Harbor can execute. This is borrowing, not an earn APY. Ask me for the amount and confirm token decimals before queuing a borrow; do not approve or submit anything.`,
                }}
              />
            }
          >
            Research in Chat
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
