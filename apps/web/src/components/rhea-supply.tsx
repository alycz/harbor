import { useEffect, useState } from 'react';
import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { call } from '../lib/execution.ts';
import { useWallet } from '../lib/wallet.tsx';
import { Panel } from './workspace.tsx';

type Asset = { canonicalId: string; symbol: string };
type Preview = { plan: { amount: string; tokenId: string; signerId: string; expiresAt: number }; limitation: string };

export function RheaSupply() {
  const wallet = useWallet();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setPreview(null); setAssets([]); setAssetId(''); setError(null);
    if (wallet.address) void call<{ assets: Asset[] }>('/api/lending/rhea/assets').then((data) => {
      if (active) { setAssets(data.assets); setAssetId(data.assets[0]?.canonicalId ?? ''); }
    }).catch(() => { if (active) setError('Could not load NEAR assets.'); });
    return () => { active = false; };
  }, [wallet.address]);
  async function prepare() {
    setBusy(true); setError(null); setPreview(null);
    try { setPreview(await call<Preview>('/api/lending/rhea/prepare', { method: 'POST', body: { assetId, amount } })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not prepare supply.'); }
    finally { setBusy(false); }
  }
  return <Panel label="Rhea lending · preparation only" bodyClassName="p-5">
    <p className="mb-4 text-sm text-muted-foreground">Check your real NEAR balance, Rhea market availability and storage registration, then preview a supply transaction. This does not sign or send funds. Lending approval and settlement are not enabled.</p>
    {wallet.address ? <div className="flex flex-wrap gap-3">
      <label>Token<select aria-label="Rhea supply token" disabled={busy} value={assetId} onChange={(e) => { setAssetId(e.target.value); setPreview(null); }}>
        {assets.map((asset) => <option key={asset.canonicalId} value={asset.canonicalId}>{asset.symbol}</option>)}
      </select></label>
      <Input aria-label="Rhea supply amount" disabled={busy} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} />
      <Button disabled={busy || !assetId || !amount} onClick={prepare}>{busy ? 'Checking chain…' : 'Preview supply'}</Button>
    </div> : <Button onClick={wallet.connect} disabled={wallet.connecting}>Connect wallet</Button>}
    {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    {preview && preview.plan.signerId === wallet.address ? <div className="mt-4 text-sm">
      <p>Prepared {preview.plan.amount} atomic units of {preview.plan.tokenId} for {preview.plan.signerId}.</p>
      <p>Preview expires at {new Date(preview.plan.expiresAt).toLocaleTimeString()}.</p>
      <p>{preview.limitation}</p>
    </div> : null}
  </Panel>;
}
