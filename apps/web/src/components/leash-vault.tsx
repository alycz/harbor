import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@harbor/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Bot, Check, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, Snowflake } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';

import { call, ExecutionRequestError, execution as executionApi, type SwapAsset } from '../lib/execution.ts';
import { canSubmitLeash, fromAtomic, toAtomic } from '../lib/leash-ui.ts';
import { useWallet, type WalletTransaction } from '../lib/wallet.tsx';
import { AssetIcon } from './asset-icon.tsx';
import { AssetSelect, chainName } from './asset-select.tsx';
import { UnitInput } from './unit-input.tsx';
import { Chip, FactRow, Panel } from './workspace.tsx';

type Snapshot = {
  owner: string;
  contractId: string;
  executionAvailable: boolean;
  limitation: string;
  vault: null | {
    balance: string;
    frozen: boolean;
    spent_today: string;
    limits: {
      token: string;
      per_action?: string;
      per_day?: string;
      buy_assets: string[];
      recipients: string[];
      max_slippage_bps: number;
      expires_at_ms?: number;
    };
  };
};
type Prepared = { signerId: string; transaction: WalletTransaction; summary: string };
type Execution = { id: string; state?: string; status?: string; settled?: boolean; txHash?: string };
type Operation = 'set_limits' | 'fund' | 'withdraw' | 'freeze' | 'unfreeze';

const OPERATIONS: { value: Operation; label: string }[] = [
  { value: 'set_limits', label: 'Set limits' },
  { value: 'fund', label: 'Add funds' },
  { value: 'withdraw', label: 'Withdraw' },
  { value: 'freeze', label: 'Freeze' },
  { value: 'unfreeze', label: 'Unfreeze' },
];
const NEAR_DECIMALS = 24;
const TOGGLE_ON = 'border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] text-[var(--ws-accent-ink)]';

/**
 * Leash: a budget the agent can spend on its own, inside limits a NEAR contract enforces. Until the
 * contract is deployed and configured on this server it explains itself rather than showing a form
 * that can only fail.
 */
export function LeashVault() {
  const wallet = useWallet();
  return (
    <Panel
      label="On-chain budget for the agent"
      icon={<LockKeyhole />}
      labelId="leash-vault"
      bodyClassName="p-5 @xl/workspace:p-6"
    >
      {wallet.address ? (
        <OwnerVault key={wallet.address} owner={wallet.address} />
      ) : (
        <div className="space-y-5">
          <Explainer />
          <Button className="h-10 px-4" disabled={wallet.connecting || wallet.restoring} onClick={wallet.connect}>
            Connect wallet to manage your budget
          </Button>
        </div>
      )}
    </Panel>
  );
}

/** What Leash is, in three facts: who sets what, what the agent can do, and what stays yours. */
function Explainer() {
  const facts: { icon: ReactNode; title: string; body: string }[] = [
    {
      icon: <ShieldCheck />,
      title: 'You set the limits',
      body: 'One token, a cap per trade and per day, the assets it may buy, your own delivery addresses and an end date.',
    },
    {
      icon: <Bot />,
      title: 'The agent works inside them',
      body: 'It can pay only a quote NEAR Intents signed, that fits every limit, once. The contract checks each one.',
    },
    {
      icon: <KeyRound />,
      title: 'You keep control',
      body: 'Freeze, unfreeze or withdraw at any time from your wallet. The agent can do none of these.',
    },
  ];
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
        Put a budget in a Leash vault and Harbor's agent can act on your monitors without asking you to sign each trade,
        but only within limits the NEAR contract enforces. Your signed policy above is checked by Harbor's server; Leash
        moves the same kind of rules on chain.
      </p>
      <ul className="grid gap-3 @2xl/workspace:grid-cols-3">
        {facts.map((fact) => (
          <li key={fact.title} className="rounded-lg border border-border bg-card p-4">
            <span aria-hidden="true" className="text-[var(--ws-accent-ink)] [&_svg]:size-4.5">
              {fact.icon}
            </span>
            <p className="mt-2.5 text-[13.5px] font-medium">{fact.title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{fact.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OwnerVault({ owner }: { owner: string }) {
  const id = useId();
  const wallet = useWallet();
  const snapshot = useQuery({
    queryKey: ['leash-vault', owner],
    queryFn: () => call<Snapshot>('/api/leash/vault'),
    retry: false,
  });
  const assets = useQuery({ queryKey: ['assets'], queryFn: executionApi.assets, staleTime: 5 * 60_000 });
  const registry = assets.data?.assets ?? [];
  const nearTokens = registry.filter((asset) => asset.chain === 'near' && asset.canonicalId.startsWith('nep141:'));

  const [operation, setOperation] = useState<Operation>('set_limits');
  const [tokenId, setTokenId] = useState('');
  const [cap, setCap] = useState('');
  const [daily, setDaily] = useState('');
  const [buyAssets, setBuyAssets] = useState<string[]>([]);
  const [recipients, setRecipients] = useState(owner);
  const [expiry, setExpiry] = useState('');
  const [slippagePct, setSlippagePct] = useState('1');
  const [storageNear, setStorageNear] = useState('0');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [quote, setQuote] = useState('');
  const [destination, setDestination] = useState('');
  const [quoteRecipient, setQuoteRecipient] = useState(owner);
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteSlippagePct, setQuoteSlippagePct] = useState('0.5');
  const [preview, setPreview] = useState<{ signedQuotePayload: string } | null>(null);
  const [execution, setExecution] = useState<Execution | null>(() => {
    try {
      const saved = localStorage.getItem(`harbor-leash:${owner}`);
      return saved ? { id: saved, state: 'recovery-required' } : null;
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

  if (snapshot.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Reading your vault…
      </p>
    );
  }
  if (snapshot.error instanceof ExecutionRequestError && snapshot.error.code === 'SETUP_REQUIRED') {
    return (
      <div className="space-y-5">
        <Explainer />
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3">
          <Chip tone="warning" dot>
            Not live yet
          </Chip>
          <p className="text-[13px] text-muted-foreground">
            The Leash contract isn't deployed for this server yet. Until it is, every trade is signed in your own
            wallet.
          </p>
        </div>
      </div>
    );
  }
  if (snapshot.error || !snapshot.data) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-[13px] text-destructive">
          {snapshot.error?.message ?? 'Could not read your vault.'}
        </p>
        <Button variant="outline" className="h-9 px-3.5" onClick={() => void snapshot.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const data = snapshot.data;
  const vault = data.vault;
  const tokenOf = (contract: string) => nearTokens.find((asset) => asset.canonicalId === `nep141:${contract}`);
  const vaultToken = vault ? tokenOf(vault.limits.token) : undefined;
  const draftToken = nearTokens.find((asset) => asset.canonicalId === tokenId);
  // Funding before limits exist uses the token chosen in the limits form.
  const amountToken = vaultToken ?? draftToken;
  const symbol = (asset: SwapAsset | undefined) => asset?.symbol ?? '';
  const readable = (raw: string | undefined, asset: SwapAsset | undefined) =>
    raw === undefined ? '—' : asset ? `${fromAtomic(raw, asset.decimals)} ${asset.symbol}` : `${raw} (atomic units)`;
  const assetOf = (canonicalId: string) => registry.find((asset) => asset.canonicalId === canonicalId);
  const locked = busy || Boolean(prepared);

  async function prepare() {
    let body: unknown;
    if (operation === 'set_limits') {
      if (!draftToken) throw new Error('Choose the token the vault holds.');
      const expiresAt = new Date(expiry).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Choose an end date in the future.');
      const slippage = Math.round(Number(slippagePct) * 100);
      if (!Number.isFinite(slippage) || slippage < 0 || slippage > 10_000) {
        throw new Error('Set a slippage from 0% to 100%.');
      }
      body = {
        operation,
        storageDepositYocto: toAtomic(storageNear || '0', NEAR_DECIMALS),
        limits: {
          token: draftToken.canonicalId.slice('nep141:'.length),
          per_action: toAtomic(cap, draftToken.decimals),
          per_day: toAtomic(daily, draftToken.decimals),
          buy_assets: buyAssets,
          recipients: recipients
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          max_slippage_bps: slippage,
          expires_at_ms: expiresAt,
        },
      };
    } else if (operation === 'fund' || operation === 'withdraw') {
      if (!amountToken) throw new Error('Set the vault limits first, so Harbor knows its token.');
      body = { operation, amount: toAtomic(amount, amountToken.decimals) };
    } else {
      body = { operation };
    }
    const response = await call<Omit<Prepared, 'summary'>>('/api/leash/prepare-owner-action', {
      method: 'POST',
      body,
    });
    if (response.signerId !== owner) throw new Error('Owner mismatch. Refresh your session.');
    const summaries: Record<Operation, string> = {
      set_limits: `Set your vault to ${symbol(draftToken)}: up to ${cap} per trade and ${daily} a day, buying ${buyAssets.length} asset${buyAssets.length === 1 ? '' : 's'}, until ${new Date(expiry).toLocaleString()}.`,
      fund: `Add ${amount} ${symbol(amountToken)} to your vault.`,
      withdraw: `Withdraw ${amount} ${symbol(amountToken)} from your vault to your account.`,
      freeze: 'Freeze your vault. The agent cannot spend from it until you unfreeze it.',
      unfreeze: 'Unfreeze your vault. The agent can spend within your limits again.',
    };
    setPrepared({ ...response, summary: summaries[operation] });
  }

  const resetQuote = () => {
    setPreview(null);
    setQuote('');
  };

  return (
    <div className="space-y-6">
      <section aria-label="Your vault" className="rounded-lg border border-border bg-card px-4 py-1">
        <dl>
          <FactRow
            label="Vault"
            value={
              vault ? (
                <Chip tone={vault.frozen ? 'danger' : 'success'} dot>
                  {vault.frozen ? 'Frozen' : 'Active'}
                </Chip>
              ) : (
                'Not opened yet'
              )
            }
          />
          {vault ? (
            <>
              <FactRow label="Balance" value={readable(vault.balance, vaultToken)} />
              <FactRow label="Spent today" value={readable(vault.spent_today, vaultToken)} />
              <FactRow
                label="Limits"
                value={`${readable(vault.limits.per_action, vaultToken)} per trade, ${readable(vault.limits.per_day, vaultToken)} a day, ${vault.limits.max_slippage_bps / 100}% slippage`}
              />
              <FactRow
                label="May buy"
                value={vault.limits.buy_assets.map((asset) => assetOf(asset)?.symbol ?? asset).join(', ') || '—'}
              />
              <FactRow label="Delivers to" value={vault.limits.recipients.join(', ') || '—'} />
            </>
          ) : null}
          <FactRow label="Contract" value={<span className="font-mono text-[12px]">{data.contractId}</span>} />
        </dl>
      </section>

      <section aria-labelledby={`${id}-manage`} className="space-y-4">
        <h3 id={`${id}-manage`} className="text-[14px] font-medium">
          Manage your vault
        </h3>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Vault action</legend>
          {OPERATIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={operation === option.value}
              disabled={locked}
              onClick={() => setOperation(option.value)}
              className={`h-9 rounded-md border px-3.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 ${
                operation === option.value
                  ? TOGGLE_ON
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </fieldset>

        {operation === 'set_limits' ? (
          <div className="grid gap-x-5 gap-y-4 @2xl/workspace:grid-cols-2">
            <Field id={`${id}-token`} label="Token the vault holds" hint="The agent spends only this token.">
              <AssetSelect
                id={`${id}-token`}
                value={tokenId}
                onChange={setTokenId}
                disabled={locked}
                choices={nearTokens.map((asset) => ({
                  value: asset.canonicalId,
                  symbol: asset.symbol,
                  detail: chainName(asset.chain),
                }))}
                placeholder="Choose a NEAR token"
              />
            </Field>
            <Field id={`${id}-expiry`} label="Ends" hint="After this, the agent can spend nothing.">
              <Input
                id={`${id}-expiry`}
                type="datetime-local"
                className="h-10"
                value={expiry}
                disabled={locked}
                onChange={(event) => setExpiry(event.target.value)}
              />
            </Field>
            <Field id={`${id}-cap`} label="Most per trade" hint="The largest single swap the agent may pay.">
              <UnitInput
                id={`${id}-cap`}
                unit={symbol(draftToken)}
                value={cap}
                inputMode="decimal"
                disabled={locked}
                onChange={setCap}
              />
            </Field>
            <Field id={`${id}-daily`} label="Most per day" hint="Counted over the contract's daily window.">
              <UnitInput
                id={`${id}-daily`}
                unit={symbol(draftToken)}
                value={daily}
                inputMode="decimal"
                disabled={locked}
                onChange={setDaily}
              />
            </Field>
            <Field id={`${id}-slippage`} label="Most slippage" hint="Quotes allowing more are refused.">
              <UnitInput
                id={`${id}-slippage`}
                unit="%"
                value={slippagePct}
                inputMode="decimal"
                disabled={locked}
                onChange={setSlippagePct}
              />
            </Field>
            <Field
              id={`${id}-recipients`}
              label="Delivery addresses"
              hint="Your own addresses, separated by commas. Bought assets can go nowhere else."
            >
              <Input
                id={`${id}-recipients`}
                className="h-10"
                value={recipients}
                disabled={locked}
                onChange={(event) => setRecipients(event.target.value)}
              />
            </Field>
            <fieldset className="@2xl/workspace:col-span-2">
              <legend className="mb-2 text-[13px] font-medium">Assets the agent may buy</legend>
              <div className="flex flex-wrap gap-2">
                {registry
                  .filter((asset) => asset.canonicalId !== tokenId)
                  .map((asset) => {
                    const on = buyAssets.includes(asset.canonicalId);
                    return (
                      <button
                        key={asset.canonicalId}
                        type="button"
                        aria-pressed={on}
                        disabled={locked}
                        onClick={() =>
                          setBuyAssets((current) =>
                            on
                              ? current.filter((value) => value !== asset.canonicalId)
                              : [...current, asset.canonicalId],
                          )
                        }
                        className={`inline-flex h-9 items-center gap-2 rounded-full border pr-3 pl-1.5 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 ${
                          on ? TOGGLE_ON : 'border-border bg-card text-foreground hover:bg-secondary/60'
                        }`}
                      >
                        <AssetIcon symbol={asset.symbol} className="size-6" />
                        {asset.symbol}
                        <span className="text-[12px] text-muted-foreground">{chainName(asset.chain)}</span>
                        {on ? <Check className="size-3.5" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
              </div>
            </fieldset>
            <details className="@2xl/workspace:col-span-2">
              <summary className="cursor-pointer text-[13px] text-muted-foreground">Storage deposit</summary>
              <div className="mt-3 max-w-sm">
                <Field
                  id={`${id}-storage`}
                  label="Attach for storage"
                  hint="NEAR the contract keeps for your vault record. Leave 0 if your vault already exists."
                >
                  <UnitInput
                    id={`${id}-storage`}
                    unit="NEAR"
                    value={storageNear}
                    inputMode="decimal"
                    disabled={locked}
                    onChange={setStorageNear}
                  />
                </Field>
              </div>
            </details>
          </div>
        ) : null}

        {operation === 'fund' || operation === 'withdraw' ? (
          <div className="max-w-sm">
            <Field
              id={`${id}-amount`}
              label={operation === 'fund' ? 'Amount to add' : 'Amount to withdraw'}
              hint={operation === 'fund' ? 'Sent from your wallet into the vault.' : 'Returned to your account.'}
            >
              <UnitInput
                id={`${id}-amount`}
                unit={symbol(amountToken)}
                value={amount}
                inputMode="decimal"
                disabled={locked}
                onChange={setAmount}
              />
            </Field>
          </div>
        ) : null}

        {operation === 'freeze' || operation === 'unfreeze' ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Snowflake className="size-4" aria-hidden="true" />
            {operation === 'freeze'
              ? 'Stops the agent from spending at once. Your funds stay in the vault.'
              : 'Lets the agent spend again, within your limits.'}
          </p>
        ) : null}

        {prepared ? (
          <div className="space-y-3 rounded-lg border border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] p-4">
            <p className="text-[13.5px] font-medium">{prepared.summary}</p>
            <details>
              <summary className="cursor-pointer text-[12.5px] text-muted-foreground">
                See the exact transaction, including attached NEAR
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-card p-3 text-[11.5px] break-all whitespace-pre-wrap">
                {JSON.stringify(prepared.transaction, null, 2)}
              </pre>
            </details>
            <div className="flex flex-wrap gap-2.5">
              <Button
                className="h-10 px-4"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const transaction = prepared.transaction;
                    setPrepared(null);
                    const hash = await wallet.sendTransaction(transaction);
                    setMessage(`Signed. Transaction ${hash}. Your vault refreshes above once it lands.`);
                    void snapshot.refetch();
                  })
                }
              >
                Sign in wallet
              </Button>
              <Button variant="outline" className="h-10 px-4" disabled={busy} onClick={() => setPrepared(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button className="h-10 px-4" disabled={busy} onClick={() => void run(prepare)}>
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
            Review in wallet
          </Button>
        )}
      </section>

      {vault ? (
        <section aria-labelledby={`${id}-swap`} className="space-y-4 border-t border-border pt-5">
          <div>
            <h3 id={`${id}-swap`} className="text-[14px] font-medium">
              Let the agent make a swap
            </h3>
            <p className="mt-1 max-w-2xl text-[12.5px] text-muted-foreground">
              Harbor gets a quote NEAR Intents signs and checks it against your vault. You approve that exact quote; the
              agent can submit nothing else.
            </p>
          </div>
          <div className="grid gap-x-5 gap-y-4 @2xl/workspace:grid-cols-2">
            <Field id={`${id}-buy`} label="Buy" hint="One of the assets your vault allows.">
              <AssetSelect
                id={`${id}-buy`}
                value={destination}
                disabled={busy || Boolean(execution)}
                choices={vault.limits.buy_assets.map((asset) => {
                  const known = assetOf(asset);
                  return { value: asset, symbol: known?.symbol ?? asset, detail: known ? chainName(known.chain) : '' };
                })}
                placeholder="Choose an allowed asset"
                onChange={(value) => {
                  setDestination(value);
                  resetQuote();
                }}
              />
            </Field>
            <Field id={`${id}-to`} label="Deliver to" hint="One of your vault's delivery addresses.">
              <Select
                value={quoteRecipient || null}
                onValueChange={(value) => {
                  if (value === null) return;
                  setQuoteRecipient(String(value));
                  resetQuote();
                }}
                disabled={busy || Boolean(execution)}
              >
                <SelectTrigger
                  id={`${id}-to`}
                  className="h-10 w-full rounded-md border-input bg-card px-3 text-[13.5px] data-[size=default]:h-10"
                >
                  <SelectValue>
                    {quoteRecipient || <span className="text-muted-foreground">Choose an address</span>}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="p-1.5">
                  {vault.limits.recipients.map((address) => (
                    <SelectItem key={address} value={address} className="min-h-10 rounded-md pr-9 pl-2.5 text-[13px]">
                      {address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id={`${id}-pay`} label="Pay" hint="Within your per-trade and daily limits.">
              <UnitInput
                id={`${id}-pay`}
                unit={symbol(vaultToken)}
                value={quoteAmount}
                inputMode="decimal"
                disabled={busy || Boolean(execution)}
                onChange={(value) => {
                  setQuoteAmount(value);
                  resetQuote();
                }}
              />
            </Field>
            <Field id={`${id}-quote-slippage`} label="Slippage" hint="No more than your vault allows.">
              <UnitInput
                id={`${id}-quote-slippage`}
                unit="%"
                value={quoteSlippagePct}
                inputMode="decimal"
                disabled={busy || Boolean(execution)}
                onChange={(value) => {
                  setQuoteSlippagePct(value);
                  resetQuote();
                }}
              />
            </Field>
          </div>
          <Button
            className="h-10 px-4"
            disabled={busy || Boolean(execution) || !destination || !quoteAmount || !quoteRecipient || !vaultToken}
            onClick={() =>
              void run(async () => {
                if (!vaultToken) throw new Error('Harbor does not recognise your vault token.');
                resetQuote();
                const result = await call<{ quoteResponse: unknown; signedQuotePayload: string }>('/api/leash/quote', {
                  method: 'POST',
                  body: {
                    destinationAsset: destination,
                    recipient: quoteRecipient,
                    amount: toAtomic(quoteAmount, vaultToken.decimals),
                    slippageBps: Math.round(Number(quoteSlippagePct) * 100),
                  },
                });
                setQuote(JSON.stringify(result.quoteResponse));
                setPreview({ signedQuotePayload: result.signedQuotePayload });
              })
            }
          >
            Get a signed quote
          </Button>
          <details>
            <summary className="cursor-pointer text-[12.5px] text-muted-foreground">
              Import a signed quote instead
            </summary>
            <textarea
              aria-label="Provider-signed quote JSON"
              className="mt-2 min-h-28 w-full rounded-md border border-input bg-card p-3 font-mono text-[11.5px]"
              value={quote}
              disabled={busy || Boolean(execution)}
              onChange={(event) => {
                setQuote(event.target.value);
                setPreview(null);
              }}
            />
            <Button
              variant="outline"
              className="mt-2 h-9 px-3.5"
              disabled={busy || !quote || Boolean(execution)}
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
              Check this quote
            </Button>
          </details>
          {preview ? (
            <div className="space-y-3 rounded-lg border border-border bg-card p-4">
              <p className="text-[13.5px] font-medium">Quote verified against your vault</p>
              <details>
                <summary className="cursor-pointer text-[12.5px] text-muted-foreground">See the signed quote</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-secondary/30 p-3 text-[11.5px] break-all whitespace-pre-wrap">
                  {preview.signedQuotePayload}
                </pre>
              </details>
              <Button
                className="h-10 px-4"
                disabled={busy || Boolean(execution) || !data.executionAvailable}
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
              {!data.executionAvailable ? (
                <p className="text-[12.5px] text-muted-foreground">{data.limitation}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {execution ? (
        <section aria-label="Approved swap" className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13.5px] font-medium">Approved swap</p>
            <Chip tone={execution.settled ? 'success' : 'neutral'} dot>
              {execution.settled === true
                ? 'Delivery verified'
                : (execution.state ?? execution.status ?? 'Not yet verified').replaceAll('-', ' ')}
            </Chip>
          </div>
          <dl className="text-[12.5px]">
            <FactRow label="Execution" value={<span className="font-mono text-[11.5px]">{execution.id}</span>} />
            {execution.txHash ? (
              <FactRow
                label="Transaction"
                value={<span className="font-mono text-[11.5px]">{execution.txHash}</span>}
              />
            ) : null}
          </dl>
          <div className="flex flex-wrap gap-2.5">
            <Button
              className="h-10 px-4"
              disabled={!canSubmitLeash(data.executionAvailable, busy, attempted, execution.state ?? execution.status)}
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
              Submit the approved quote
            </Button>
            <Button
              variant="outline"
              className="h-10 px-4"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setExecution(await call<Execution>(`/api/leash/executions/${encodeURIComponent(execution.id)}`));
                })
              }
            >
              Check status
            </Button>
            {execution.settled === true ? (
              <Button
                variant="outline"
                className="h-10 px-4"
                disabled={busy}
                onClick={() => {
                  try {
                    localStorage.removeItem(`harbor-leash:${owner}`);
                  } catch {
                    /* optional persistence */
                  }
                  setExecution(null);
                  resetQuote();
                  setAttempted(false);
                }}
              >
                Start another swap
              </Button>
            ) : null}
          </div>
          <p className="text-[12px] text-muted-foreground">
            After a timeout or reload, check status instead of submitting again. A transaction hash alone does not prove
            delivery.
          </p>
        </section>
      ) : null}

      {message ? (
        <p role="status" className="text-[13px] break-words">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled setting with a short hint under it. */
function Field({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      {children}
      <p className="text-[12px] text-muted-foreground">{hint}</p>
    </div>
  );
}
