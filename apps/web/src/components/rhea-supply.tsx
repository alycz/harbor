import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useEffect, useState } from 'react';
import { call } from '../lib/execution.ts';
import { useWallet, type WalletTransaction } from '../lib/wallet.tsx';
import { Panel } from './workspace.tsx';

type Asset = { canonicalId: string; symbol: string };
type Approval = {
  id: string;
  digest: string;
  message: string;
  nonce: string;
  recipient: string;
  status: string;
  txHash: string | null;
  expiresAt: number;
  signerId: string;
  amount: string;
  tokenId: string;
};
type Preview = {
  plan: { amount: string; tokenId: string; signerId: string; expiresAt: number };
  limitation: string;
  executionEnabled: boolean;
  approval: Approval | null;
};
const recoveryKey = (owner: string) => `harbor.rhea.supply.${owner}`;

export function RheaSupply({
  initialAssetId,
  initialAmount,
}: {
  initialAssetId?: string;
  initialAmount?: string;
} = {}) {
  const wallet = useWallet();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState(initialAmount ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [hash, setHash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setApproval(null);
    setHash('');
    setAssets([]);
    setAssetId('');
    setError(null);
    if (wallet.address) {
      void call<{ assets: Asset[] }>('/api/lending/rhea/assets')
        .then((data) => {
          if (active) {
            setAssets(data.assets);
            setAssetId(
              initialAssetId && data.assets.some((asset) => asset.canonicalId === initialAssetId)
                ? initialAssetId
                : initialAssetId
                  ? ''
                  : (data.assets[0]?.canonicalId ?? ''),
            );
          }
        })
        .catch(() => {
          if (active) setError('Could not load NEAR assets.');
        });
      const saved = localStorage.getItem(recoveryKey(wallet.address));
      if (saved)
        void call<Approval>(`/api/lending/rhea/plans/${encodeURIComponent(saved)}`)
          .then((plan) => {
            if (active) {
              setApproval(plan);
              setHash(plan.txHash ?? '');
            }
          })
          .catch(() => {
            if (active) setError('Could not restore the previous supply. Do not resend until its outcome is known.');
          });
    }
    return () => {
      active = false;
    };
  }, [wallet.address, initialAssetId]);
  async function prepare() {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const result = await call<Preview>('/api/lending/rhea/prepare', {
        method: 'POST',
        body: { assetId, amount },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      setPreview(result);
      setApproval(result.approval);
      if (result.approval) localStorage.setItem(recoveryKey(result.approval.signerId), result.approval.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not prepare supply.');
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await wallet.signMessage({
        message: approval.message,
        recipient: approval.recipient,
        nonce: approval.nonce,
      });
      setApproval(
        await call<Approval>(`/api/lending/rhea/plans/${approval.id}/approve`, {
          method: 'POST',
          body: { digest: approval.digest, ...signed },
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Approval failed.');
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      const issued = await call<Approval & { transaction: WalletTransaction }>(
        `/api/lending/rhea/plans/${approval.id}/claim`,
        { method: 'POST' },
      );
      setApproval(issued);
      const txHash = await wallet.sendTransaction(issued.transaction);
      setHash(txHash);
      setApproval(
        await call<Approval>(`/api/lending/rhea/plans/${approval.id}/settle`, { method: 'POST', body: { txHash } }),
      );
    } catch (caught) {
      setError(
        `${caught instanceof Error ? caught.message : 'Wallet request interrupted.'} Check wallet history before doing anything again. This plan cannot issue a second transaction.`,
      );
      void call<Approval>(`/api/lending/rhea/plans/${approval.id}`)
        .then(setApproval)
        .catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (!approval || !hash) return;
    setBusy(true);
    setError(null);
    try {
      setApproval(
        await call<Approval>(`/api/lending/rhea/plans/${approval.id}/settle`, {
          method: 'POST',
          body: { txHash: hash },
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Verification unavailable.');
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      setApproval(await call<Approval>(`/api/lending/rhea/plans/${approval.id}/cancel`, { method: 'POST' }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cancellation unavailable.');
    } finally {
      setBusy(false);
    }
  }
  const current = approval?.signerId === wallet.address ? approval : null;
  const outstanding = current && !['cancelled', 'confirmed'].includes(current.status);
  return (
    <Panel label="Rhea lending · supply" bodyClassName="p-5">
      <p className="mb-4 text-sm text-muted-foreground">
        Real on-chain supply preparation. Execution requires operator enablement, a one-time approval and your wallet
        signature. Supply does not opt assets into collateral. Protocol and withdrawal risks apply.
      </p>
      {wallet.address ? (
        <div className="flex flex-wrap gap-3">
          <label>
            Token
            <select
              aria-label="Rhea supply token"
              disabled={busy || !!outstanding}
              value={assetId}
              onChange={(e) => {
                setAssetId(e.target.value);
                setPreview(null);
              }}
            >
              {assets.map((asset) => (
                <option key={asset.canonicalId} value={asset.canonicalId}>
                  {asset.symbol}
                </option>
              ))}
            </select>
          </label>
          <Input
            aria-label="Rhea supply amount"
            disabled={busy || !!outstanding}
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setPreview(null);
            }}
          />
          <Button disabled={busy || !!outstanding || !assetId || !amount} onClick={prepare}>
            {busy ? 'Working…' : 'Prepare supply'}
          </Button>
        </div>
      ) : (
        <Button onClick={wallet.connect} disabled={wallet.connecting}>
          Connect wallet
        </Button>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {preview && preview.plan.signerId === wallet.address ? (
        <p className="mt-4 text-sm">{preview.limitation}</p>
      ) : null}
      {current ? (
        <div className="mt-4 space-y-3 text-sm">
          <p>
            {current.amount} atomic units of {current.tokenId} for {current.signerId}.
          </p>
          <p>
            Status: {current.status}. Approval expires {new Date(current.expiresAt).toLocaleTimeString()}.
          </p>
          {current.status === 'prepared' ? (
            <>
              <pre className="whitespace-pre-wrap break-words">{current.message}</pre>
              <Button disabled={busy} onClick={approve}>
                Approve this supply only
              </Button>
            </>
          ) : null}
          {current.status === 'approved' ? (
            <Button disabled={busy} onClick={send}>
              Sign and supply in wallet
            </Button>
          ) : null}
          {['prepared', 'approved'].includes(current.status) ? (
            <Button disabled={busy} onClick={cancel}>
              Cancel plan
            </Button>
          ) : null}
          {['awaiting_signature', 'outcome_unknown'].includes(current.status) ? (
            <>
              <p>Do not resend. Check your wallet history and verify the existing transaction below.</p>
              <Input
                aria-label="Supply transaction hash"
                value={hash}
                onChange={(e) => setHash(e.target.value.trim())}
              />
              <Button disabled={busy || !hash} onClick={refresh}>
                Verify transaction
              </Button>
            </>
          ) : null}
          {current.status === 'confirmed' ? (
            <p>Final chain receipt confirms the full supply amount was accepted by Rhea.</p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
