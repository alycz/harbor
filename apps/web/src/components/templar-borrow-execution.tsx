import { Button } from '@harbor/ui/components/button';
import { useState } from 'react';
import { call } from '../lib/execution.ts';
import { useWallet, type WalletTransaction } from '../lib/wallet.tsx';

interface Plan {
  id: string;
  accountId: string;
  state: string;
  digest: string;
  binding: unknown;
  challenge: { message: string; nonce: string; recipient: string };
  txHash: string | null;
}
/** A separate explicit wallet approval for one borrow; never signs automatically. */
export function TemplarBorrowExecution({ marketId, amountAtomic }: { marketId: string; amountAtomic: string }) {
  const wallet = useWallet();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(false);
  const [hash, setHash] = useState('');
  const [message, setMessage] = useState('');
  async function review() {
    setBusy(true);
    setMessage('');
    setPlan(null);
    setIssued(false);
    setHash('');
    try {
      setPlan(await call<Plan>('/api/templar/borrow-plans', { method: 'POST', body: { marketId, amountAtomic } }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Plan unavailable.');
    } finally {
      setBusy(false);
    }
  }
  async function sign() {
    if (!plan || plan.accountId !== wallet.address || issued) return;
    setBusy(true);
    setMessage('');
    try {
      const signature = await wallet.signMessage(plan.challenge);
      // A failed/ambiguous issuance must not cause an automatic second wallet submission.
      setIssued(true);
      const approved = await call<{ transaction: WalletTransaction }>(`/api/templar/borrow-plans/${plan.id}/approve`, {
        method: 'POST',
        body: { digest: plan.digest, ...signature },
      });
      const txHash = await wallet.sendTransaction(approved.transaction);
      setHash(txHash);
      setMessage('Wallet submitted. Check final receipt below; no confirmed loan is claimed yet.');
    } catch (e) {
      setMessage(
        `${e instanceof Error ? e.message : 'Wallet flow interrupted.'} Inspect wallet activity before creating another plan.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function receipt() {
    if (!plan || !hash) return;
    setBusy(true);
    try {
      const result = await call<{ state: string; detail: string }>(`/api/templar/borrow-plans/${plan.id}/receipt`, {
        method: 'POST',
        body: { txHash: hash },
      });
      setMessage(`${result.state}: ${result.detail}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Receipt unavailable. Do not resend.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded border p-3">
      <p className="text-sm">
        Real borrow: creates debt and liquidation risk. Existing collateral and market registration are required. Only
        operator-enabled markets can proceed. Wallet confirmation is always required.
      </p>
      <Button disabled={busy || !wallet.address || issued} onClick={review}>
        Review real borrow
      </Button>
      {plan && plan.accountId === wallet.address ? (
        <div className="space-y-2">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{plan.challenge.message}</pre>
          <p className="text-xs">
            Plan ID: {plan.id}. Save this ID and your transaction hash for recovery. Approval expires after two minutes;
            an issued blockchain transaction itself has no Harbor expiry.
          </p>
          <Button disabled={busy || issued} onClick={sign}>
            Approve debt and open wallet
          </Button>
          <label className="block text-sm">
            Transaction hash (paste from wallet if interrupted)
            <input className="block w-full rounded border p-2" value={hash} onChange={(e) => setHash(e.target.value)} />
          </label>
          <Button disabled={busy || !hash} onClick={receipt}>
            Check final receipt
          </Button>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
