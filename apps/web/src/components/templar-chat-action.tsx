import { useEffect, useState } from 'react';
import { call } from '../lib/execution.ts';
import { TemplarBorrowExecution } from './templar-borrow-execution.tsx';

interface TemplarMarket {
  marketId: string;
  configuration: { borrow_asset: unknown; collateral_asset: unknown; [key: string]: unknown };
  observedAt: string;
  borrowingEnabled: boolean;
  note: string;
}
function useTemplarMarket(marketId: string) {
  const [market, setMarket] = useState<TemplarMarket | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setMarket(null);
    setError('');
    if (!marketId) return;
    call<TemplarMarket>(`/api/templar/markets/${encodeURIComponent(marketId)}`).then(
      (value) => {
        if (active) setMarket(value);
      },
      () => {
        if (active) setError('Market details unavailable. No transaction can be queued from this read.');
      },
    );
    return () => {
      active = false;
    };
  }, [marketId]);
  return { market, error };
}
function TemplarMarketDetails({ market }: { market: TemplarMarket }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        Borrow asset: <code>{JSON.stringify(market.configuration.borrow_asset)}</code>
      </p>
      <p>
        Collateral: <code>{JSON.stringify(market.configuration.collateral_asset)}</code>
      </p>
      <p>
        {market.borrowingEnabled
          ? 'Borrow review available; wallet approval still required.'
          : 'Research only: execution is not enabled for this market.'}
      </p>
      <p className="text-xs text-muted-foreground">
        Finalized contract read: {market.observedAt}. {market.note}
      </p>
      <details>
        <summary>Market configuration and risk parameters</summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(market.configuration, null, 2)}
        </pre>
      </details>
    </div>
  );
}
/** Queue renderer. A chat suggestion never approves or submits a transaction. */
export function TemplarChatAction({ marketId, amountAtomic }: { marketId: string; amountAtomic: string }) {
  const { market, error } = useTemplarMarket(marketId);
  const valid = /^[1-9][0-9]{0,38}$/.test(amountAtomic) && BigInt(amountAtomic) < 2n ** 128n;
  return (
    <section className="space-y-3 rounded border p-4" aria-label="Queued Templar borrow">
      <h3 className="font-medium">Templar borrow review</h3>
      <p className="text-sm">
        {marketId} · {amountAtomic} atomic units. Borrowing creates debt and liquidation risk, not yield.
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !market ? (
        <p>Reading market details…</p>
      ) : (
        <>
          <TemplarMarketDetails market={market} />
          {market.borrowingEnabled && valid ? (
            <TemplarBorrowExecution
              key={`${marketId}:${amountAtomic}`}
              marketId={marketId}
              amountAtomic={amountAtomic}
            />
          ) : null}
        </>
      )}
      {!valid ? <p role="alert">Use a positive integer token amount in atomic units.</p> : null}
    </section>
  );
}
