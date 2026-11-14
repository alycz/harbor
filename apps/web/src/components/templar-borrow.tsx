import { TemplarBorrowExecution } from './templar-borrow-execution.tsx';
import { useState } from 'react';
import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { call } from '../lib/execution.ts';
import { useWallet } from '../lib/wallet.tsx';
import { Panel } from './workspace.tsx';

interface Prepared { accountId: string; marketId: string; limitation: string; preparedTransaction: unknown; registration: unknown; configuration: unknown; }
export function TemplarBorrow() {
  const wallet = useWallet();
  const [marketId, setMarket] = useState('');
  const [amount, setAmount] = useState('');
  const [operation, setOperation] = useState('borrow');
  const [markets, setMarkets] = useState<string[]>([]);
  const [offset, setOffset] = useState<number | null>(0);
  const [result, setResult] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true); setError('');
    try {
      const page = await call<{ markets: string[]; nextOffset?: number | null }>('/api/templar/markets?offset=' + (offset ?? 0));
      setMarkets((prior) => [...new Set([...prior, ...page.markets])]); setOffset(page.nextOffset ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Market read failed.'); }
    finally { setBusy(false); }
  }
  async function prepare() {
    setBusy(true); setError(''); setResult(null);
    try { setResult(await call<Prepared>('/api/templar/prepare', { method: 'POST', body: { marketId, operation, amountAtomic: amount } })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Preparation failed.'); }
    finally { setBusy(false); }
  }
  return <Panel label="Templar: live contract preparation" bodyClassName="space-y-3 p-5">
    <p className="text-sm text-muted-foreground">Reads Templar's mainnet registry and prepares real contract calls. Real borrow signing requires a separate reviewed plan and operator enablement. Registry entries can include retired markets.</p>
    <Button disabled={busy || offset === null} onClick={load}>Load {markets.length ? 'more ' : ''}markets</Button>
    <label className="block text-sm">Market
      <select className="block w-full rounded border p-2" value={marketId} onChange={(e) => { setMarket(e.target.value); setResult(null); }}>
        <option value="">Select a registry market</option>{markets.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
    </label>
    <label className="block text-sm">Action
      <select className="block w-full rounded border p-2" value={operation} onChange={(e) => { setOperation(e.target.value); setResult(null); }}>
        <option value="borrow">Borrow</option><option value="collateralize">Deposit collateral</option><option value="repay">Repay</option><option value="withdrawCollateral">Withdraw collateral</option>
      </select>
    </label>
    <label className="block text-sm">Amount in token atomic units (not decimal token units)
      <Input inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setResult(null); }} />
    </label>
    {wallet.address ? <Button disabled={busy || !marketId || !/^[1-9][0-9]*$/.test(amount)} onClick={prepare}>Prepare for review</Button> :
      <Button disabled={wallet.connecting} onClick={wallet.connect}>Connect wallet</Button>}
    {operation === 'borrow' && marketId && /^[1-9][0-9]*$/.test(amount) ? <TemplarBorrowExecution key={marketId + ':' + amount + ':' + wallet.address} marketId={marketId} amountAtomic={amount} /> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {result && result.accountId === wallet.address ? <div className="space-y-2">
      <p className="text-sm">{result.limitation}</p>
      <details><summary>Inspect contract calls and market configuration</summary>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </div> : null}
  </Panel>;
}
