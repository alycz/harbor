import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { call } from '../lib/execution.ts';
import { canSubmitLeash, requireLeashAmount } from '../lib/leash-ui.ts';
import { useWallet, type WalletTransaction } from '../lib/wallet.tsx';
import { Panel } from './workspace.tsx';

type Snapshot = {
  owner: string;
  contractId: string;
  executionAvailable: boolean;
  limitation: string;
  vault: null | { balance: string; frozen: boolean; spent_today: string; limits: Record<string, unknown> };
};
type Prepared = { signerId: string; transaction: WalletTransaction };
type Execution = { id: string; state?: string; status?: string; settled?: boolean; txHash?: string };

/** Remount owner state on account changes; never share an approval between accounts. */
export function LeashVault() {
  const wallet = useWallet();
  return (
    <Panel label="Leash vault" bodyClassName="p-5">
      <p className="mb-4 text-sm text-muted-foreground">
        Set a dedicated budget, fund your vault, and explicitly approve a provider-signed swap. Your wallet signs owner
        actions; a configured restricted agent submits only your approved quote.
      </p>
      {wallet.address ? (
        <OwnerVault key={wallet.address} owner={wallet.address} />
      ) : (
        <Button disabled={wallet.connecting || wallet.restoring} onClick={() => void wallet.connect()}>
          Connect wallet for Leash
        </Button>
      )}
    </Panel>
  );
}

function OwnerVault({ owner }: { owner: string }) {
  const wallet = useWallet();
  const snapshot = useQuery({
    queryKey: ['leash-vault', owner],
    queryFn: () => call<Snapshot>('/api/leash/vault'),
    retry: false,
  });
  const [operation, setOperation] = useState('set_limits');
  const [token, setToken] = useState('');
  const [cap, setCap] = useState('');
  const [daily, setDaily] = useState('');
  const [assets, setAssets] = useState('');
  const [recipients, setRecipients] = useState(owner);
  const [expiry, setExpiry] = useState('');
  const [slippage, setSlippage] = useState('100');
  const [storage, setStorage] = useState('0');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [quote, setQuote] = useState('');
  const [preview, setPreview] = useState<{ signedQuotePayload: string } | null>(null);
  const [execution, setExecution] = useState<Execution | null>(() => {
    try {
      const id = localStorage.getItem(`harbor-leash:${owner}`);
      return id ? { id, state: 'recovery-required' } : null;
    } catch {
      return null;
    }
  });
  const [attempted, setAttempted] = useState(Boolean(execution));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Request failed. Check status before retrying any transaction.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const field = (label: string, value: string, change: (value: string) => void, type = 'text') => (
    <label htmlFor={`leash-${label}`} className="grid min-w-0 gap-1 text-sm">
      {label}
      <Input
        id={`leash-${label}`}
        type={type}
        value={value}
        disabled={busy || !!prepared}
        onChange={(event) => change(event.target.value)}
      />
    </label>
  );
  return (
    <div className="space-y-5">
      {snapshot.error && (
        <p role="alert" className="text-sm">
          {snapshot.error.message}
        </p>
      )}
      {snapshot.data && (
        <div className="space-y-2 break-words text-sm">
          <p>Contract: {snapshot.data.contractId}</p>
          <p>
            Vault:{' '}
            {snapshot.data.vault
              ? `${snapshot.data.vault.frozen ? 'Frozen' : 'Active'} · balance ${snapshot.data.vault.balance} · spent today ${snapshot.data.vault.spent_today} (atomic units)`
              : 'Not created'}
          </p>
          <p>{snapshot.data.limitation}</p>
        </div>
      )}
      <Button disabled={busy} onClick={() => void snapshot.refetch()}>
        Refresh vault
      </Button>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const body =
              operation === 'set_limits'
                ? {
                    operation,
                    storageDepositYocto: requireLeashAmount(storage),
                    limits: {
                      token,
                      per_action: requireLeashAmount(cap, true),
                      per_day: requireLeashAmount(daily, true),
                      buy_assets: assets
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                      recipients: recipients
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                      max_slippage_bps: Number(slippage),
                      expires_at_ms: new Date(expiry).getTime(),
                    },
                  }
                : ['fund', 'withdraw'].includes(operation)
                  ? { operation, amount: requireLeashAmount(amount, true) }
                  : { operation };
            const response = await call<Prepared>('/api/leash/prepare-owner-action', { method: 'POST', body });
            if (response.signerId !== owner) throw new Error('Owner mismatch. Refresh your session.');
            setPrepared(response);
          });
        }}
      >
        <h3 className="font-medium">1. Set up and fund</h3>
        <label className="grid gap-1 text-sm">
          Owner action
          <select
            className="rounded border p-2"
            value={operation}
            disabled={busy || !!prepared}
            onChange={(e) => setOperation(e.target.value)}
          >
            {['set_limits', 'fund', 'withdraw', 'freeze', 'unfreeze'].map((value) => (
              <option key={value} value={value}>
                {value.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        {operation === 'set_limits' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {field('NEAR token contract', token, setToken)}
            {field('Per action (atomic units)', cap, setCap)}
            {field('Per day (atomic units)', daily, setDaily)}
            {field('Buy asset IDs (comma separated)', assets, setAssets)}
            {field('Permitted recipients (comma separated)', recipients, setRecipients)}
            {field('Expiry (your local time)', expiry, setExpiry, 'datetime-local')}
            {field('Maximum slippage (basis points)', slippage, setSlippage)}
            {field('Storage deposit (yoctoNEAR)', storage, setStorage)}
          </div>
        )}
        {['fund', 'withdraw'].includes(operation) &&
          field('Token amount (atomic units, not decimal tokens)', amount, setAmount)}
        <Button type="submit" disabled={busy || !!prepared || !snapshot.data}>
          Prepare wallet transaction
        </Button>
      </form>
      {prepared && (
        <div className="space-y-3">
          <p className="text-sm">
            Review the exact transaction, including attached NEAR. Signing sends this owner action.
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-3 text-xs">
            {JSON.stringify(prepared.transaction, null, 2)}
          </pre>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const transaction = prepared.transaction;
                setPrepared(null);
                const hash = await wallet.sendTransaction(transaction);
                setMessage(`Wallet returned transaction ${hash}. Refresh the vault to verify its effect.`);
                void snapshot.refetch();
              })
            }
          >
            Review and sign in wallet
          </Button>
          <Button disabled={busy} onClick={() => setPrepared(null)}>
            Cancel
          </Button>
        </div>
      )}
      <div className="space-y-3">
        <h3 className="font-medium">2. Review a signed quote</h3>
        <p className="text-sm text-muted-foreground">
          Paste a complete provider-signed 1Click quote response. The server checks its signature, expiry and vault
          rules. Previewing does not authorize execution.
        </p>
        <textarea
          aria-label="Provider-signed quote JSON"
          className="min-h-28 w-full rounded border p-3 font-mono text-xs"
          value={quote}
          disabled={busy || !!execution}
          onChange={(e) => {
            setQuote(e.target.value);
            setPreview(null);
          }}
        />
        <Button
          disabled={busy || !quote || !!execution}
          onClick={() =>
            void run(async () => {
              setPreview(
                await call<{ signedQuotePayload: string }>('/api/leash/preview', {
                  method: 'POST',
                  body: { quoteResponse: JSON.parse(quote) },
                }),
              );
            })
          }
        >
          Preview quote
        </Button>
        {preview && (
          <>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-3 text-xs">
              {preview.signedQuotePayload}
            </pre>
            <Button
              disabled={busy || !!execution || !snapshot.data?.executionAvailable}
              onClick={() =>
                void run(async () => {
                  const result = await call<Execution>('/api/leash/approve', {
                    method: 'POST',
                    body: { quoteResponse: JSON.parse(quote) },
                  });
                  setExecution(result);
                  setAttempted(false);
                  try {
                    localStorage.setItem(`harbor-leash:${owner}`, result.id);
                  } catch {
                    /* In-memory recovery remains available. */
                  }
                })
              }
            >
              Approve this exact quote
            </Button>
          </>
        )}
      </div>
      {execution && (
        <div className="space-y-3 break-words text-sm">
          <h3 className="font-medium">3. Submit and verify</h3>
          <p>Execution ID: {execution.id}</p>
          <p>
            Status:{' '}
            {execution.settled === true
              ? 'Delivery independently verified'
              : (execution.state ?? execution.status ?? 'Not yet verified')}
          </p>
          {execution.txHash && <p>Transaction: {execution.txHash}</p>}
          <Button
            disabled={
              !canSubmitLeash(!!snapshot.data?.executionAvailable, busy, attempted, execution.state ?? execution.status)
            }
            onClick={() =>
              void run(async () => {
                setAttempted(true);
                setExecution({ ...execution, state: 'submission-requested' });
                const result = await call<Execution>(
                  `/api/leash/executions/${encodeURIComponent(execution.id)}/submit`,
                  { method: 'POST' },
                );
                setExecution({ ...result, id: execution.id });
              })
            }
          >
            Submit approved quote
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setExecution(await call<Execution>(`/api/leash/executions/${encodeURIComponent(execution.id)}`));
              })
            }
          >
            Check status / recover
          </Button>
          <p>
            After a timeout or reload, check status rather than resubmit. A transaction hash alone does not prove
            delivery.
          </p>
          {execution.settled === true && (
            <Button
              disabled={busy}
              onClick={() => {
                try {
                  localStorage.removeItem(`harbor-leash:${owner}`);
                } catch {
                  /* optional persistence */
                }
                setExecution(null);
                setPreview(null);
                setQuote('');
                setAttempted(false);
              }}
            >
              Start another quote
            </Button>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="break-words text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
