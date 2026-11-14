import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Bot, Check, CircleAlert, LoaderCircle, LockKeyhole, Snowflake } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';

import { call, ExecutionRequestError, execution as executionApi, type SwapAsset } from '../lib/execution.ts';
import {
  ALLOWANCE_DAYS,
  allowanceParts,
  canSubmitLeash,
  expiryAfterDays,
  fromAtomic,
  type SentencePart,
  toAtomic,
} from '../lib/leash-ui.ts';
import { useWallet, type WalletTransaction } from '../lib/wallet.tsx';
import { AssetIcon } from './asset-icon.tsx';
import { AssetSelect, chainName } from './asset-select.tsx';
import { UnitInput } from './unit-input.tsx';
import { Chip, Panel } from './workspace.tsx';

type Limits = {
  token: string;
  per_action?: string;
  per_day?: string;
  buy_assets: string[];
  recipients: string[];
  max_slippage_bps: number;
  expires_at_ms?: number;
};
type Vault = { balance: string; frozen: boolean; spent_today: string; limits: Limits };
type Snapshot = {
  owner: string;
  contractId: string;
  executionAvailable: boolean;
  limitation: string;
  vault: Vault | null;
};
type Execution = { id: string; state?: string; status?: string; settled?: boolean; txHash?: string };
type OwnerAction =
  | { operation: 'set_limits'; limits: Limits; storageDepositYocto: string }
  | { operation: 'fund' | 'withdraw'; amount: string }
  | { operation: 'freeze' | 'unfreeze' };

const NEAR_DECIMALS = 24;
const WNEAR = 'nep141:wrap.near';
/** Attached when opening or editing a vault; the contract keeps what the record uses and refunds the rest. */
const STORAGE_NEAR = '0.05';
/** The NEAR token contract: a vault holds wrapped NEAR, so native NEAR is wrapped before a deposit. */
const WRAP_NEAR = 'wrap.near';
const TOGGLE_ON = 'border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] text-[var(--ws-accent-ink)]';
const TOGGLE_OFF = 'border-border bg-card text-muted-foreground hover:text-foreground';

/**
 * Leash: a budget Harbor's agent can spend without asking for each trade, inside limits a NEAR contract
 * enforces. The rules read back as one sentence; everything but the budget and its length has a default.
 */
export function LeashVault() {
  const wallet = useWallet();
  if (wallet.address) return <OwnerVault key={wallet.address} owner={wallet.address} />;
  return (
    <BudgetPanel>
      <div className="space-y-4">
        <Intro />
        <Button className="h-10 px-4" disabled={wallet.connecting || wallet.restoring} onClick={wallet.connect}>
          Connect wallet
        </Button>
      </div>
    </BudgetPanel>
  );
}

function BudgetPanel({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <Panel
      label="Agent budget"
      icon={<LockKeyhole />}
      labelId="leash-vault"
      aside={status}
      bodyClassName="p-5 @xl/workspace:p-6"
    >
      {children}
    </Panel>
  );
}

/** Two columns on a wide screen, words on the left and controls on the right; stacked on a phone. */
const SPLIT = 'grid gap-x-10 gap-y-7 @3xl/workspace:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]';
const CONTROLS = 'min-w-0 space-y-5 @3xl/workspace:border-l @3xl/workspace:border-border @3xl/workspace:pl-10';

function Intro() {
  return (
    <p className="max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
      Give Harbor's agent a small budget it can spend without asking you each time. A NEAR contract holds the money and
      checks every trade against your rules, and you can freeze or withdraw it whenever you like.
    </p>
  );
}

function OwnerVault({ owner }: { owner: string }) {
  const snapshot = useQuery({
    queryKey: ['leash-vault', owner],
    queryFn: () => call<Snapshot>('/api/leash/vault'),
    retry: false,
  });
  const assets = useQuery({ queryKey: ['assets'], queryFn: executionApi.assets, staleTime: 5 * 60_000 });
  const [editing, setEditing] = useState(false);

  if (snapshot.isPending || assets.isPending) {
    return (
      <BudgetPanel>
        <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Reading your budget…
        </p>
      </BudgetPanel>
    );
  }
  if (snapshot.error instanceof ExecutionRequestError && snapshot.error.code === 'SETUP_REQUIRED') {
    return (
      <BudgetPanel
        status={
          <Chip tone="warning" dot>
            Not on this server yet
          </Chip>
        }
      >
        <div className="space-y-3">
          <Intro />
          <p className="text-[13px] text-muted-foreground">Until it is, you sign every trade in your own wallet.</p>
        </div>
      </BudgetPanel>
    );
  }
  if (snapshot.error || !snapshot.data) {
    return (
      <BudgetPanel>
        <div className="space-y-3">
          <Problem>{snapshot.error?.message ?? 'Could not read your budget.'}</Problem>
          <Button variant="outline" className="h-9 px-3.5" onClick={() => void snapshot.refetch()}>
            Try again
          </Button>
        </div>
      </BudgetPanel>
    );
  }

  const data = snapshot.data;
  const registry = assets.data?.assets ?? [];
  const refresh = () => snapshot.refetch().then((result) => result.data?.vault ?? null);
  const state = data.vault ? vaultState(data.vault) : null;
  const status = state ? (
    <Chip tone={state.tone} dot>
      {state.label}
    </Chip>
  ) : undefined;

  if (!data.vault || editing) {
    return (
      <BudgetPanel status={status}>
        <AllowanceEditor
          owner={owner}
          registry={registry}
          vault={data.vault}
          refresh={refresh}
          onStart={() => setEditing(true)}
          onCancel={data.vault ? () => setEditing(false) : undefined}
          onDone={() => setEditing(false)}
        />
      </BudgetPanel>
    );
  }
  return (
    <>
      <BudgetPanel status={status}>
        <VaultOverview
          vault={data.vault}
          owner={owner}
          registry={registry}
          refresh={refresh}
          onEdit={() => setEditing(true)}
        />
      </BudgetPanel>
      <Panel
        label="Let the agent make a swap"
        icon={<Bot />}
        labelId="leash-swap"
        bodyClassName="p-5 @xl/workspace:p-6"
      >
        <AgentSwap owner={owner} vault={data.vault} registry={registry} snapshot={data} />
      </Panel>
    </>
  );
}

function vaultState(vault: Vault): { tone: 'success' | 'warning' | 'danger'; label: string } {
  if (vault.frozen) return { tone: 'danger', label: 'Frozen' };
  if (vault.limits.expires_at_ms !== undefined && vault.limits.expires_at_ms <= Date.now()) {
    return { tone: 'warning', label: 'Ended' };
  }
  return { tone: 'success', label: 'Active' };
}

/** Opening a vault, or changing its rules: a budget and how long it lasts, the rest under Advanced. */
function AllowanceEditor({
  owner,
  registry,
  vault,
  refresh,
  onStart,
  onCancel,
  onDone,
}: {
  owner: string;
  registry: readonly SwapAsset[];
  vault: Vault | null;
  refresh: () => Promise<Vault | null>;
  /** Called when the wallet steps begin, so the page keeps this view until the owner presses Done. */
  onStart: () => void;
  onCancel?: (() => void) | undefined;
  onDone: () => void;
}) {
  const id = useId();
  // Opening or editing is fixed when the editor mounts: the vault appearing mid-flow must not change it.
  const [opening] = useState(vault === null);
  const wallet = useWallet();
  const nearTokens = registry.filter((asset) => asset.chain === 'near' && asset.canonicalId.startsWith('nep141:'));
  const byId = (canonicalId: string) => registry.find((asset) => asset.canonicalId === canonicalId);
  const usdc = nearTokens.find((asset) => asset.symbol === 'USDC');
  const existing = vault ? nearTokens.find((asset) => asset.canonicalId === `nep141:${vault.limits.token}`) : undefined;

  const [tokenId, setTokenId] = useState(existing?.canonicalId ?? usdc?.canonicalId ?? '');
  const token = nearTokens.find((asset) => asset.canonicalId === tokenId);
  const defaultBuys = (forToken: string) => {
    const near = byId(WNEAR);
    return forToken === WNEAR || !near ? (usdc ? [usdc.canonicalId] : []) : [near.canonicalId];
  };
  const [daily, setDaily] = useState(
    vault && existing ? fromAtomic(vault.limits.per_day ?? '0', existing.decimals) : '',
  );
  const [perTrade, setPerTrade] = useState(
    vault && existing ? fromAtomic(vault.limits.per_action ?? '0', existing.decimals) : '',
  );
  const [days, setDays] = useState<number>(7);
  const [buyAssets, setBuyAssets] = useState<string[]>(vault?.limits.buy_assets ?? defaultBuys(tokenId));
  const [recipients, setRecipients] = useState((vault?.limits.recipients ?? [owner]).join(', '));
  const [slippagePct, setSlippagePct] = useState(vault ? String(vault.limits.max_slippage_bps / 100) : '1');
  const [fund, setFund] = useState('');
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState('');
  const running = steps?.some((step) => step.state === 'active') ?? false;

  const recipientList = recipients
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const effectivePerTrade = perTrade || daily;
  const endsAt = new Date(expiryAfterDays(days, Date.now()));
  const symbol = token?.symbol ?? '';
  const presetApplied =
    Boolean(usdc) && tokenId === usdc?.canonicalId && daily === '2' && fund === '2' && days === 1 && !perTrade;
  const parts = allowanceParts({
    daily,
    perTrade: effectivePerTrade,
    symbol,
    buys: buyAssets.map((asset) => byId(asset)?.symbol ?? asset),
    toOwnAccount: recipientList.length === 1 && recipientList[0] === owner,
    recipients: recipientList.length,
    endsAt,
  });

  function tryPreset() {
    if (!usdc) return;
    setTokenId(usdc.canonicalId);
    setDaily('2');
    setPerTrade('');
    setDays(1);
    setBuyAssets(defaultBuys(usdc.canonicalId));
    setRecipients(owner);
    setSlippagePct('1');
    setFund('2');
    setError('');
  }

  async function save() {
    setError('');
    if (!token) return setError('Choose the token the agent spends.');
    let perDayRaw: string;
    let perTradeRaw: string;
    let fundRaw = '0';
    try {
      perDayRaw = toAtomic(daily, token.decimals);
      perTradeRaw = toAtomic(effectivePerTrade, token.decimals);
      if (opening && fund) fundRaw = toAtomic(fund, token.decimals);
    } catch (caught) {
      return setError(caught instanceof Error ? caught.message : 'Check the amounts.');
    }
    if (BigInt(perDayRaw) === 0n) return setError('Set a daily budget above zero.');
    if (BigInt(perTradeRaw) > BigInt(perDayRaw))
      return setError('The per-trade cap cannot be more than the daily budget.');
    if (!buyAssets.length) return setError('Choose at least one asset the agent may buy.');
    if (!recipientList.length) return setError('Add at least one of your own addresses.');
    const slippage = Math.round(Number(slippagePct) * 100);
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 10_000)
      return setError('Set slippage from 0% to 100%.');

    const limits: Limits = {
      token: token.canonicalId.slice('nep141:'.length),
      per_action: perTradeRaw,
      per_day: perDayRaw,
      buy_assets: buyAssets,
      recipients: recipientList,
      max_slippage_bps: slippage,
      expires_at_ms: expiryAfterDays(days, Date.now()),
    };

    let registrations: WalletTransaction[];
    try {
      ({ transactions: registrations } = await call<{ transactions: WalletTransaction[] }>(
        `/api/leash/setup?token=${encodeURIComponent(limits.token)}&buy=${encodeURIComponent(buyAssets.join(','))}`,
      ));
    } catch (caught) {
      return setError(caught instanceof Error ? caught.message : 'Could not check your token registrations.');
    }
    const plan: Step[] = [
      ...registrations.map((transaction): Step => {
        const tokenSymbol = nearTokens.find(
          (asset) => asset.canonicalId === `nep141:${transaction.receiverId}`,
        )?.symbol;
        return {
          label: `Let your account hold ${tokenSymbol ?? transaction.receiverId} (one time)`,
          state: 'waiting',
          run: () => wallet.sendTransaction(transaction).then(() => undefined),
        };
      }),
      {
        label: opening ? 'Open your vault' : 'Save the new rules',
        state: 'waiting',
        run: () =>
          signOwnerAction(wallet.sendTransaction, owner, {
            operation: 'set_limits',
            limits,
            storageDepositYocto: toAtomic(STORAGE_NEAR, NEAR_DECIMALS),
          }),
      },
    ];
    if (opening && fundRaw !== '0') {
      if (limits.token === WRAP_NEAR) {
        plan.push({
          label: `Wrap ${fund} NEAR so the vault can hold it`,
          state: 'waiting',
          run: () => wallet.sendTransaction(wrapNearCall(fundRaw)).then(() => undefined),
        });
      }
      plan.push({
        label: `Add ${fund} ${symbol}`,
        state: 'waiting',
        run: async () => {
          // The vault must exist on chain before it can be funded.
          let current = await refresh();
          for (let attempt = 0; attempt < 10 && !current; attempt += 1) {
            await sleep(1_500);
            current = await refresh();
          }
          const before = BigInt(current?.balance ?? '0');
          await signOwnerAction(wallet.sendTransaction, owner, { operation: 'fund', amount: fundRaw });
          await confirmDeposit(refresh, before);
        },
      });
    }
    onStart();
    await runSteps(plan, setSteps, setError);
  }

  const finished = Boolean(steps?.length) && (steps ?? []).every((step) => step.state === 'done');

  return (
    <div className={SPLIT}>
      {/* The agreement, in words. The form beside it only fills in its blanks. */}
      <div className="space-y-5">
        {!opening ? (
          <p className="text-[13.5px] text-muted-foreground">
            Change what the agent may do. Your wallet signs the new rules.
          </p>
        ) : (
          <Intro />
        )}
        <Sentence parts={parts} className="max-w-[30ch] text-[23px] @xl/workspace:text-[27px]" />
      </div>

      <div className={CONTROLS}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13.5px] font-medium">{opening ? 'Set the budget' : 'Your rules'}</p>
          {!opening || !usdc ? null : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-3 text-[12.5px]"
              aria-pressed={presetApplied}
              disabled={running}
              onClick={tryPreset}
            >
              {presetApplied ? <Check className="text-success" aria-hidden="true" /> : null}
              Prefill 2 USDC test
            </Button>
          )}
        </div>

        <Field id={`${id}-daily`} label="Daily budget">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <UnitInput
                id={`${id}-daily`}
                unit={symbol}
                value={daily}
                inputMode="decimal"
                disabled={running}
                onChange={setDaily}
              />
            </div>
            <div className="w-[10.75rem] shrink-0">
              <AssetSelect
                label="Token the agent spends"
                value={tokenId}
                disabled={running || Boolean(vault && BigInt(vault.balance) > 0n)}
                onChange={(next) => {
                  setTokenId(next);
                  if (opening) setBuyAssets(defaultBuys(next));
                }}
                choices={nearTokens.map((asset) => ({
                  value: asset.canonicalId,
                  symbol: asset.symbol,
                  detail: chainName(asset.chain),
                }))}
                placeholder="Token"
              />
            </div>
          </div>
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">Lasts for</legend>
          <div className="grid grid-cols-3 gap-2">
            {ALLOWANCE_DAYS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={days === option}
                disabled={running}
                onClick={() => setDays(option)}
                className={`h-10 rounded-md border text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 ${days === option ? TOGGLE_ON : TOGGLE_OFF}`}
              >
                {option === 1 ? '1 day' : `${option} days`}
              </button>
            ))}
          </div>
        </fieldset>

        {!opening ? null : (
          <Field
            id={`${id}-fund`}
            label="Put in now"
            hint="Sent from your wallet into the vault. You can add more later."
          >
            <UnitInput
              id={`${id}-fund`}
              unit={symbol}
              value={fund}
              inputMode="decimal"
              disabled={running}
              onChange={setFund}
            />
          </Field>
        )}

        <details className="group border-t border-border pt-4">
          <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground select-none hover:text-foreground">
            Advanced
          </summary>
          <div className="mt-4 space-y-5">
            <Field id={`${id}-trade`} label="Most per trade" hint="Empty allows the whole daily budget in one trade.">
              <UnitInput
                id={`${id}-trade`}
                unit={symbol}
                value={perTrade}
                inputMode="decimal"
                disabled={running}
                onChange={setPerTrade}
              />
            </Field>
            <Field id={`${id}-slip`} label="Most slippage" hint="Quotes that allow more are refused.">
              <UnitInput
                id={`${id}-slip`}
                unit="%"
                value={slippagePct}
                inputMode="decimal"
                disabled={running}
                onChange={setSlippagePct}
              />
            </Field>
            <Field
              id={`${id}-to`}
              label="Deliver only to"
              hint="Your own addresses, separated by commas. Nothing bought can go anywhere else."
            >
              <Input
                id={`${id}-to`}
                className="h-10"
                value={recipients}
                disabled={running}
                onChange={(event) => setRecipients(event.target.value)}
              />
            </Field>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium">May buy</legend>
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
                        disabled={running}
                        onClick={() =>
                          setBuyAssets((current) =>
                            on
                              ? current.filter((value) => value !== asset.canonicalId)
                              : [...current, asset.canonicalId],
                          )
                        }
                        className={`inline-flex h-8 items-center gap-1.5 rounded-full border pr-2.5 pl-1 text-[12.5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 ${on ? TOGGLE_ON : 'border-border bg-card text-foreground hover:bg-secondary/60'}`}
                      >
                        <AssetIcon symbol={asset.symbol} className="size-5" />
                        {asset.symbol}
                        {on ? <Check className="size-3" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
              </div>
            </fieldset>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Opening or changing the vault attaches {STORAGE_NEAR} NEAR for its storage. The contract keeps what the
              record uses, usually under 0.01 NEAR, and sends the rest back.
            </p>
          </div>
        </details>

        {steps ? <StepList steps={steps} /> : null}
        {error ? <Problem>{error}</Problem> : null}

        <div className="space-y-2.5 border-t border-border pt-5">
          <div className="flex gap-2">
            {finished ? (
              <Button className="h-11 flex-1" onClick={onDone}>
                Done
              </Button>
            ) : (
              <Button className="h-11 flex-1" disabled={running} onClick={() => void save()}>
                {running ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
                {opening ? 'Open vault' : 'Save rules'}
              </Button>
            )}
            {onCancel && !running && !finished ? (
              <Button variant="outline" className="h-11 px-4" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
          {!steps && !finished ? (
            <p className="text-[12.5px] text-muted-foreground">Your wallet asks you to confirm each step.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** An open vault: what is in it, what the agent spent today, the rules, and the owner's controls. */
function VaultOverview({
  vault,
  owner,
  registry,
  refresh,
  onEdit,
}: {
  vault: Vault;
  owner: string;
  registry: readonly SwapAsset[];
  refresh: () => Promise<Vault | null>;
  onEdit: () => void;
}) {
  const id = useId();
  const wallet = useWallet();
  const token = registry.find((asset) => asset.canonicalId === `nep141:${vault.limits.token}`);
  const decimals = token?.decimals ?? 0;
  const symbol = token?.symbol ?? vault.limits.token;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const spent = BigInt(vault.spent_today);
  const cap = BigInt(vault.limits.per_day ?? '0');
  const share = Math.min(100, cap > 0n ? Number((spent * 1000n) / cap) / 10 : 0);
  const parts = allowanceParts({
    daily: fromAtomic(vault.limits.per_day ?? '0', decimals),
    perTrade: fromAtomic(vault.limits.per_action ?? '0', decimals),
    symbol,
    buys: vault.limits.buy_assets.map(
      (asset) => registry.find((entry) => entry.canonicalId === asset)?.symbol ?? asset,
    ),
    toOwnAccount: vault.limits.recipients.length === 1 && vault.limits.recipients[0] === owner,
    recipients: vault.limits.recipients.length,
    endsAt: new Date(vault.limits.expires_at_ms ?? Date.now()),
  });

  async function act(label: string, action: OwnerAction, done: string) {
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await signOwnerAction(wallet.sendTransaction, owner, action);
      setMessage(done);
      setAmount('');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The wallet did not complete this.');
    } finally {
      setBusy(null);
    }
  }

  function amountAction(operation: 'fund' | 'withdraw') {
    let raw: string;
    try {
      raw = toAtomic(amount, decimals);
    } catch (caught) {
      return setError(caught instanceof Error ? caught.message : 'Check the amount.');
    }
    if (operation === 'withdraw') {
      void act('withdraw', { operation, amount: raw }, `Withdrew ${amount} ${symbol} to your account.`);
      return;
    }
    void addFunds(raw);
  }

  /** NEAR is wrapped first, since the vault holds wNEAR; the deposit counts only once the balance shows it. */
  async function addFunds(raw: string) {
    setBusy('fund');
    setError('');
    setMessage('');
    try {
      if (vault.limits.token === WRAP_NEAR) await wallet.sendTransaction(wrapNearCall(raw));
      await signOwnerAction(wallet.sendTransaction, owner, { operation: 'fund', amount: raw });
      await confirmDeposit(refresh, BigInt(vault.balance));
      setMessage(`Added ${amount} ${symbol}.`);
      setAmount('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The wallet did not complete this.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Your vault" className={SPLIT}>
      <div className="flex min-w-0 flex-col items-start gap-5">
        <Sentence parts={parts} className="max-w-[30ch] text-[23px] @xl/workspace:text-[27px]" />
        <Button variant="outline" className="h-9 px-3.5" disabled={Boolean(busy)} onClick={onEdit}>
          Change rules
        </Button>
      </div>

      <div className={CONTROLS}>
        <div>
          <p className="text-[13px] text-muted-foreground">In your vault</p>
          <p className="ws-num mt-1.5 text-[34px] leading-none font-medium tracking-[-0.03em]">
            {fromAtomic(vault.balance, decimals)} <span className="text-[18px] text-muted-foreground">{symbol}</span>
          </p>
          <p className="mt-4 flex justify-between gap-3 text-[12.5px] text-muted-foreground">
            <span>Spent today</span>
            <span className="ws-num">
              {fromAtomic(vault.spent_today, decimals)} of {fromAtomic(vault.limits.per_day ?? '0', decimals)} {symbol}
            </span>
          </p>
          <meter className="sr-only" min={0} max={100} value={share}>
            {share}% of today's budget spent
          </meter>
          <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-[var(--ws-accent-ink)]" style={{ width: `${share}%` }} />
          </div>
        </div>

        <div className="space-y-2.5 border-t border-border pt-5">
          <label htmlFor={`${id}-amount`} className="block text-[13px] font-medium">
            Add or withdraw
          </label>
          <UnitInput
            id={`${id}-amount`}
            unit={symbol}
            value={amount}
            inputMode="decimal"
            disabled={Boolean(busy)}
            onChange={setAmount}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Button className="h-10 px-4" disabled={Boolean(busy) || !amount} onClick={() => amountAction('fund')}>
              {busy === 'fund' ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
              Add funds
            </Button>
            <Button
              variant="outline"
              className="h-10 px-4"
              disabled={Boolean(busy) || !amount}
              onClick={() => amountAction('withdraw')}
            >
              {busy === 'withdraw' ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
              Withdraw
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <p className="text-[12.5px] leading-snug text-muted-foreground">
            {vault.frozen ? 'The agent cannot spend until you unfreeze.' : 'Stop the agent spending, at any time.'}
          </p>
          <Button
            variant="outline"
            className="h-9 shrink-0 gap-2 px-3.5"
            disabled={Boolean(busy)}
            onClick={() =>
              void act(
                'freeze',
                { operation: vault.frozen ? 'unfreeze' : 'freeze' },
                vault.frozen
                  ? 'The agent can spend again, within your rules.'
                  : 'Frozen. The agent cannot spend until you unfreeze.',
              )
            }
          >
            {busy === 'freeze' ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Snowflake aria-hidden="true" />
            )}
            {vault.frozen ? 'Unfreeze' : 'Freeze'}
          </Button>
        </div>
        {message ? (
          <p role="status" className="text-[13px] text-success">
            {message}
          </p>
        ) : null}
        {error ? <Problem>{error}</Problem> : null}
      </div>
    </section>
  );
}

/**
 * One swap by the agent: Harbor gets a quote NEAR Intents signs, checks it against the vault, the owner
 * approves that exact quote, and the agent sends it. Nothing is ever resent automatically.
 */
function AgentSwap({
  owner,
  vault,
  registry,
  snapshot,
}: {
  owner: string;
  vault: Vault;
  registry: readonly SwapAsset[];
  snapshot: Snapshot;
}) {
  const id = useId();
  const token = registry.find((asset) => asset.canonicalId === `nep141:${vault.limits.token}`);
  const decimals = token?.decimals ?? 0;
  const symbol = token?.symbol ?? '';
  const perTrade = BigInt(vault.limits.per_action ?? '0');
  const balance = BigInt(vault.balance);
  // BigInt has no Math.min: the most the agent may pay in one trade, or the whole balance if that is less.
  let suggested = balance;
  if (perTrade < balance) suggested = perTrade;
  const [amount, setAmount] = useState(suggested > 0n ? fromAtomic(suggested.toString(), decimals) : '');
  const [destination, setDestination] = useState(vault.limits.buy_assets[0] ?? '');
  const [recipient, setRecipient] = useState(vault.limits.recipients[0] ?? owner);
  const [slippagePct, setSlippagePct] = useState(String(Math.min(vault.limits.max_slippage_bps, 50) / 100));
  const [quote, setQuote] = useState<{ response: unknown; signedQuotePayload: string } | null>(null);
  const [pasted, setPasted] = useState('');
  const [execution, setExecution] = useState<Execution | null>(() => {
    try {
      const saved = localStorage.getItem(`harbor-leash:${owner}`);
      return saved ? { id: saved, state: 'recovery-required' } : null;
    } catch {
      return null;
    }
  });
  const [attempted, setAttempted] = useState(Boolean(execution));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const buy = registry.find((asset) => asset.canonicalId === destination);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something failed. Check the status before trying again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const getQuote = () =>
    run(async () => {
      setQuote(null);
      const result = await call<{ quoteResponse: unknown; signedQuotePayload: string }>('/api/leash/quote', {
        method: 'POST',
        body: {
          destinationAsset: destination,
          recipient,
          amount: toAtomic(amount, decimals),
          slippageBps: Math.round(Number(slippagePct) * 100),
        },
      });
      setQuote({ response: result.quoteResponse, signedQuotePayload: result.signedQuotePayload });
    });

  const approveAndSend = (response: unknown) =>
    run(async () => {
      const approved = await call<Execution>('/api/leash/approve', {
        method: 'POST',
        body: { quoteResponse: response },
      });
      try {
        localStorage.setItem(`harbor-leash:${owner}`, approved.id);
      } catch {
        /* Recovery stays in memory. */
      }
      setExecution(approved);
      if (!canSubmitLeash(snapshot.executionAvailable, false, false, approved.state ?? approved.status)) return;
      setAttempted(true);
      setExecution({ ...approved, state: 'submission-requested' });
      const sent = await call<Execution>(`/api/leash/executions/${encodeURIComponent(approved.id)}/submit`, {
        method: 'POST',
      });
      setExecution({ ...sent, id: approved.id });
    });

  const checkStatus = (current: Execution) =>
    run(async () => {
      setExecution(await call<Execution>(`/api/leash/executions/${encodeURIComponent(current.id)}`));
    });

  if (execution) {
    const state = execution.state ?? execution.status ?? '';
    return (
      <section aria-labelledby={`${id}-swap`} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${id}-swap`} className="text-[14px] font-medium">
            The agent's swap
          </h3>
          <Chip tone={execution.settled ? 'success' : 'neutral'} dot>
            {execution.settled ? 'Delivered and checked' : statusLabel(state)}
          </Chip>
        </div>
        {execution.txHash ? (
          <a
            href={`https://nearblocks.io/txns/${execution.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ws-accent-ink)] hover:underline"
          >
            View the payment on NEARBlocks <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        ) : null}
        <div className="flex flex-wrap gap-2.5">
          {canSubmitLeash(snapshot.executionAvailable, busy, attempted, state) ? (
            <Button
              className="h-10 px-4"
              onClick={() =>
                void run(async () => {
                  setAttempted(true);
                  const sent = await call<Execution>(
                    `/api/leash/executions/${encodeURIComponent(execution.id)}/submit`,
                    { method: 'POST' },
                  );
                  setExecution({ ...sent, id: execution.id });
                })
              }
            >
              Send it
            </Button>
          ) : null}
          <Button variant="outline" className="h-10 px-4" disabled={busy} onClick={() => void checkStatus(execution)}>
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
            Check status
          </Button>
          {execution.settled ? (
            <Button
              variant="ghost"
              className="h-10 px-4"
              onClick={() => {
                try {
                  localStorage.removeItem(`harbor-leash:${owner}`);
                } catch {
                  /* optional */
                }
                setExecution(null);
                setQuote(null);
                setAttempted(false);
              }}
            >
              Make another swap
            </Button>
          ) : null}
        </div>
        <p className="text-[12px] text-muted-foreground">
          If the page reloads or times out, check the status instead of sending again. A payment alone does not prove
          delivery; Harbor checks that too.
        </p>
        {error ? <Problem>{error}</Problem> : null}
      </section>
    );
  }

  const summary = quoteSummary(quote?.response);
  const swapStep = quote ? 1 : 0;
  return (
    <div className={SPLIT}>
      <div className="min-w-0">
        <p className="max-w-[46ch] text-[13.5px] leading-relaxed text-muted-foreground">
          Try it once with a small amount. The agent pays from your vault, and only for the exact quote you approve.
        </p>
        <ol className="mt-5 max-w-[46ch] space-y-3.5">
          {SWAP_STEPS.map((step, index) => {
            const done = index < swapStep;
            const current = index === swapStep;
            return (
              <li key={step} aria-current={current ? 'step' : undefined} className="flex gap-3">
                <span
                  className={`ws-num grid size-6 shrink-0 place-items-center rounded-full border text-[12px] ${
                    current
                      ? 'border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] text-[var(--ws-accent-ink)]'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {done ? <Check className="size-3.5 text-success" aria-label="Done" /> : index + 1}
                </span>
                <span
                  className={`pt-0.5 text-[13.5px] leading-relaxed ${current ? 'text-foreground' : 'text-muted-foreground'}`}
                >
                  {step}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className={CONTROLS}>
        <div className="grid gap-2.5 @md/workspace:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={`${id}-pay`} className="mb-1.5 block text-[13px] font-medium">
              Pay
            </label>
            <UnitInput
              id={`${id}-pay`}
              unit={symbol}
              value={amount}
              inputMode="decimal"
              disabled={busy}
              onChange={(value) => {
                setAmount(value);
                setQuote(null);
              }}
            />
          </div>
          <div className="min-w-0">
            <span className="mb-1.5 block text-[13px] font-medium">For</span>
            <AssetSelect
              label="Asset the agent buys"
              value={destination}
              disabled={busy}
              choices={vault.limits.buy_assets.map((asset) => {
                const known = registry.find((entry) => entry.canonicalId === asset);
                return { value: asset, symbol: known?.symbol ?? asset, detail: known ? chainName(known.chain) : '' };
              })}
              onChange={(value) => {
                setDestination(value);
                setQuote(null);
              }}
            />
          </div>
        </div>
        {quote ? null : (
          <Button
            className="h-10 w-full px-4"
            disabled={busy || !amount || !destination || !token}
            onClick={() => void getQuote()}
          >
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
            Get quote
          </Button>
        )}

        {quote ? (
          <div className="space-y-3 rounded-[12px] border border-[var(--ws-accent-border)] bg-[var(--harbor-accent-tint)] p-4">
            <p className="flex items-center gap-2 text-[13.5px] font-medium">
              <Check className="size-4 text-success" aria-hidden="true" />
              Signed by NEAR Intents and within your rules
            </p>
            <p className="text-[14px]">
              Pay <span className="ws-num font-medium">{summary.amountIn ?? amount}</span> {symbol}, receive at least{' '}
              <span className="ws-num font-medium">{summary.minOut ?? summary.amountOut ?? '—'}</span> {buy?.symbol}
              {recipient === owner ? ' in your account.' : ` at ${recipient}.`}
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                className="h-10 px-4"
                disabled={busy || !snapshot.executionAvailable}
                onClick={() => void approveAndSend(quote.response)}
              >
                {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
                Approve and send
              </Button>
              <Button variant="ghost" className="h-10 px-3.5" disabled={busy} onClick={() => setQuote(null)}>
                Discard
              </Button>
            </div>
            {!snapshot.executionAvailable ? (
              <p className="text-[12.5px] text-muted-foreground">{snapshot.limitation}</p>
            ) : null}
          </div>
        ) : null}

        <details>
          <summary className="cursor-pointer text-[13px] font-medium text-muted-foreground select-none hover:text-foreground">
            Advanced
          </summary>
          <div className="mt-4 grid gap-x-4 gap-y-5 grid-cols-2">
            <Field id={`${id}-slip`} label="Slippage" hint="No more than your vault allows.">
              <UnitInput
                id={`${id}-slip`}
                unit="%"
                value={slippagePct}
                inputMode="decimal"
                disabled={busy}
                onChange={(value) => {
                  setSlippagePct(value);
                  setQuote(null);
                }}
              />
            </Field>
            <Field id={`${id}-to`} label="Deliver to" hint="One of your vault's addresses.">
              <select
                id={`${id}-to`}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-[13.5px]"
                value={recipient}
                disabled={busy}
                onChange={(event) => {
                  setRecipient(event.target.value);
                  setQuote(null);
                }}
              >
                {vault.limits.recipients.map((address) => (
                  <option key={address} value={address}>
                    {address === owner ? 'Your account' : address}
                  </option>
                ))}
              </select>
            </Field>
            <div className="col-span-2 space-y-2">
              <label htmlFor={`${id}-paste`} className="block text-[13px] font-medium">
                Use a signed quote you already have
              </label>
              <textarea
                id={`${id}-paste`}
                className="min-h-24 w-full rounded-md border border-input bg-card p-3 font-mono text-[11.5px]"
                value={pasted}
                disabled={busy}
                onChange={(event) => setPasted(event.target.value)}
              />
              <Button
                variant="outline"
                className="h-9 px-3.5"
                disabled={busy || !pasted}
                onClick={() =>
                  void run(async () => {
                    const response = JSON.parse(pasted) as unknown;
                    const checked = await call<{ signedQuotePayload: string }>('/api/leash/preview', {
                      method: 'POST',
                      body: { quoteResponse: response },
                    });
                    setQuote({ response, signedQuotePayload: checked.signedQuotePayload });
                  })
                }
              >
                Check this quote
              </Button>
            </div>
          </div>
        </details>
        {error ? <Problem>{error}</Problem> : null}
      </div>
    </div>
  );
}

const SWAP_STEPS = [
  'Harbor gets a quote signed by NEAR Intents and checks it against your rules.',
  'You approve that exact quote. The agent cannot send anything else.',
  'The agent pays from your vault, and Harbor checks the delivery.',
];

type Step = { label: string; state: 'waiting' | 'active' | 'done' | 'failed'; run: () => Promise<void> };

/** Runs wallet steps in order, stopping at the first one that fails; finished steps are never repeated. */
async function runSteps(plan: Step[], setSteps: (steps: Step[]) => void, setError: (message: string) => void) {
  const steps = plan.map((step) => ({ ...step }));
  setSteps([...steps]);
  for (const step of steps) {
    step.state = 'active';
    setSteps([...steps]);
    try {
      await step.run();
      step.state = 'done';
      setSteps([...steps]);
    } catch (caught) {
      step.state = 'failed';
      setSteps([...steps]);
      setError(
        caught instanceof Error && !/reject|cancel|closed/i.test(caught.message)
          ? caught.message
          : 'Stopped at this step. Nothing after it was sent; press the button again to continue.',
      );
      return;
    }
  }
}

/** The wallet steps of one save, as a short checklist: they really are a sequence. */
function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="max-w-xl space-y-2.5" aria-label="Steps in your wallet">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-3 text-[13.5px]">
          <span
            aria-hidden="true"
            className={`grid size-6 shrink-0 place-items-center rounded-full border text-[12px] font-medium ${
              step.state === 'done'
                ? 'border-transparent bg-success text-white'
                : step.state === 'active'
                  ? 'border-[var(--ws-accent-ink)] text-[var(--ws-accent-ink)]'
                  : step.state === 'failed'
                    ? 'border-destructive text-destructive'
                    : 'border-border text-muted-foreground'
            }`}
          >
            {step.state === 'done' ? (
              <Check className="size-3.5" />
            ) : step.state === 'active' ? (
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : step.state === 'failed' ? (
              <CircleAlert className="size-3.5" />
            ) : (
              index + 1
            )}
          </span>
          <span className={step.state === 'waiting' ? 'text-muted-foreground' : ''}>
            {step.label}
            {step.state === 'active' ? <span className="text-muted-foreground"> · confirm in your wallet</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Wraps native NEAR into wNEAR, one to one, in the owner's own account. */
function wrapNearCall(amountYocto: string): WalletTransaction {
  return {
    receiverId: WRAP_NEAR,
    actions: [
      {
        type: 'FunctionCall',
        params: { methodName: 'near_deposit', args: {}, gas: '10000000000000', deposit: amountYocto },
      },
    ],
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the vault balance to rise above `before`. A wallet can report a deposit the token or the
 * contract then refused, so the balance, read from the chain, is what says the money arrived.
 */
async function confirmDeposit(refresh: () => Promise<Vault | null>, before: bigint) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const vault = await refresh();
    if (vault && BigInt(vault.balance) > before) return;
    await sleep(1_500);
  }
  throw new Error(
    'Your wallet sent the deposit, but the vault balance has not changed. Check your wallet activity before trying again.',
  );
}

/** Asks Harbor for the exact owner transaction, checks it is the owner's, and has the wallet sign it. */
async function signOwnerAction(
  send: (transaction: WalletTransaction) => Promise<string>,
  owner: string,
  action: OwnerAction,
): Promise<void> {
  const prepared = await call<{ signerId: string; transaction: WalletTransaction }>('/api/leash/prepare-owner-action', {
    method: 'POST',
    body: action,
  });
  if (prepared.signerId !== owner) throw new Error('This transaction is for a different account. Reload the page.');
  await send(prepared.transaction);
}

/** The amounts a 1Click quote shows a person, when it carries them. */
function quoteSummary(response: unknown): { amountIn: string | null; amountOut: string | null; minOut: string | null } {
  const quote = (response as { quote?: Record<string, unknown> } | null)?.quote;
  const text = (key: string) => (typeof quote?.[key] === 'string' ? (quote[key] as string) : null);
  return {
    amountIn: text('amountInFormatted'),
    amountOut: text('amountOutFormatted'),
    minOut: text('minAmountOutFormatted'),
  };
}

function statusLabel(state: string): string {
  const labels: Record<string, string> = {
    'approved-not-submitted': 'Approved, not sent',
    'submission-requested': 'Sending',
    submitted: 'Sent, checking delivery',
    'outcome-unknown': 'Outcome unknown, check status',
    'recovery-required': 'Check status',
  };
  return labels[state] ?? (state ? state.replaceAll('-', ' ') : 'Not yet checked');
}

/**
 * The vault's rules read as one sentence. Parts the owner sets are underlined; one not set yet is a blank to
 * fill in, so the sentence doubles as the form's summary.
 */
function Sentence({ parts, className }: { parts: SentencePart[]; className: string }) {
  return (
    <p aria-live="polite" className={`font-display leading-[1.32] text-foreground ${className}`}>
      {parts.map((part, index) =>
        !part.value ? (
          <span key={index}>{part.text}</span>
        ) : part.text ? (
          <span
            key={index}
            className="underline decoration-[color-mix(in_oklab,var(--ws-accent-ink)_40%,transparent)] decoration-[1.5px] underline-offset-[0.2em]"
          >
            {part.text}
          </span>
        ) : (
          <span
            key={index}
            className="inline-block w-[2.6em] border-b-[1.5px] border-dashed border-muted-foreground/60"
          >
            <span className="sr-only">not set yet</span>&nbsp;
          </span>
        ),
      )}
    </p>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {children}
    </p>
  );
}
