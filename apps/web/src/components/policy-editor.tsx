import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { Label } from '@harbor/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@harbor/ui/components/select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, LoaderCircle, Plus, X } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

import { execution } from '../lib/execution.ts';
import { draftFrom, type PolicyDraft, policies, type SignedPolicyView } from '../lib/policy.ts';
import { useWallet, walletProblem } from '../lib/wallet.tsx';
import { AssetIcon } from './asset-icon.tsx';
import { AssetSelect, chainName } from './asset-select.tsx';
import { ChainLogo } from './protocol-logo.tsx';
import { UnitInput } from './unit-input.tsx';
import { Toggle } from './workspace.tsx';

const CHAINS = [
  { value: 'base', label: 'Base' },
  { value: 'arb', label: 'Arbitrum' },
  { value: 'eth', label: 'Ethereum' },
  { value: 'sol', label: 'Solana' },
  { value: 'near', label: 'Another NEAR account' },
] as const;

/** A destination chain with its logo, as the chain dropdown shows it. */
function ChainChoice({ chain }: { chain: string }) {
  const label = CHAINS.find((entry) => entry.value === chain)?.label ?? chain;
  return (
    <span className="flex items-center gap-2.5">
      <ChainLogo chain={chainName(chain)} className="size-5" />
      {label}
    </span>
  );
}

/** One group of policy fields under a short title, separated from the next by a hairline. */
function PolicySection({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <fieldset className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <legend className="float-left mb-3.5 w-full text-[14px] font-medium">{title}</legend>
      <div className="clear-both grid gap-3.5 @xl/workspace:grid-cols-2">{children}</div>
      {note ? <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">{note}</p> : null}
    </fieldset>
  );
}

function Field({
  id,
  label,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-2 ${wide ? '@xl/workspace:col-span-2' : ''}`}>
      <Label htmlFor={id} className="text-[12.5px] font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * The policy editor. Saving drafts the policy on the server, which returns the exact message the wallet
 * shows; the owner signs it there, and only then does it take effect.
 */
export function PolicyEditor({ current }: { current: SignedPolicyView | null }) {
  const id = useId();
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PolicyDraft>(() => draftFrom(current));
  const [slippage, setSlippage] = useState(() => String(draftFrom(current).slippageMaxBps / 100));
  const [phase, setPhase] = useState<'editing' | 'signing'>('editing');
  const [error, setError] = useState<string | null>(null);
  const assets = useQuery({ queryKey: ['assets'], queryFn: execution.assets, staleTime: 5 * 60_000 });
  const all = assets.data?.assets ?? [];
  const sellable = all.filter((asset) => asset.chain === 'near');

  const update = (patch: Partial<PolicyDraft>) => setDraft((previous) => ({ ...previous, ...patch }));
  const toggleAsset = (symbol: string) =>
    update({
      assets: draft.assets.includes(symbol)
        ? draft.assets.filter((entry) => entry !== symbol)
        : [...draft.assets, symbol],
    });

  async function sign() {
    setError(null);
    const slippageMaxBps = Math.round(Number(slippage) * 100);
    if (!Number.isFinite(slippageMaxBps) || slippageMaxBps < 1 || slippageMaxBps > 500) {
      setError('Set a slippage limit between 0.01% and 5%.');
      return;
    }
    setPhase('signing');
    try {
      const drafted = await policies.draft({ ...draft, slippageMaxBps });
      const signed = await wallet.signMessage(drafted);
      const result = await policies.sign(drafted.id, signed);
      queryClient.setQueryData(['policy', wallet.address], result);
      await queryClient.invalidateQueries({ queryKey: ['plan'] });
    } catch (caught) {
      setError(walletProblem(caught));
    } finally {
      setPhase('editing');
    }
  }

  return (
    <div className="space-y-6">
      <PolicySection
        title="What the agent may spend"
        note="Limits are in each asset's own units. Anything above them comes back to you for approval."
      >
        {draft.spend.map((limit, index) => (
          <div
            key={`${limit.asset}-${index}`}
            className="grid gap-3 @xl/workspace:col-span-2 @xl/workspace:grid-cols-[1fr_1fr_1fr_1fr_auto]"
          >
            <Field id={`${id}-asset-${index}`} label="Asset">
              <AssetSelect
                id={`${id}-asset-${index}`}
                value={limit.asset}
                choices={(sellable.length > 0 ? sellable : [{ symbol: limit.asset, chain: 'near' }]).map((asset) => ({
                  value: asset.symbol,
                  symbol: asset.symbol,
                  // Every asset the agent may spend lives on NEAR, so the chain would only repeat itself.
                  detail: '',
                }))}
                onChange={(asset) =>
                  update({
                    spend: draft.spend.map((entry, at) => (at === index ? { ...entry, asset } : entry)),
                  })
                }
              />
            </Field>
            {(['perAction', 'perDay', 'total'] as const).map((field) => (
              <Field
                key={field}
                id={`${id}-${field}-${index}`}
                label={field === 'perAction' ? 'Per action' : field === 'perDay' ? 'Per day' : 'In total'}
              >
                <UnitInput
                  id={`${id}-${field}-${index}`}
                  unit={limit.asset}
                  inputMode="decimal"
                  value={limit[field]}
                  onChange={(value) =>
                    update({
                      spend: draft.spend.map((entry, at) => (at === index ? { ...entry, [field]: value } : entry)),
                    })
                  }
                />
              </Field>
            ))}
            <Button
              variant="ghost"
              className="mt-auto h-10 w-10 p-0"
              aria-label={`Remove the ${limit.asset} limit`}
              disabled={draft.spend.length === 1}
              onClick={() => update({ spend: draft.spend.filter((_, at) => at !== index) })}
            >
              <X />
            </Button>
          </div>
        ))}
        <div className="@xl/workspace:col-span-2">
          <Button
            variant="outline"
            className="h-9 gap-2 px-3"
            disabled={draft.spend.length >= sellable.length}
            onClick={() => {
              const next = sellable.find((asset) => !draft.spend.some((limit) => limit.asset === asset.symbol));
              if (next)
                update({ spend: [...draft.spend, { asset: next.symbol, perAction: '', perDay: '', total: '' }] });
            }}
          >
            <Plus /> Add a limit
          </Button>
        </div>
      </PolicySection>

      <PolicySection
        title="Assets the agent may trade into"
        note="Assets you set a spend limit for are always included."
      >
        <div className="flex flex-wrap gap-2 @xl/workspace:col-span-2">
          {all.map((asset) => {
            const spent = draft.spend.some((limit) => limit.asset === asset.symbol);
            const on = spent || draft.assets.includes(asset.symbol);
            return (
              <button
                key={asset.symbol}
                type="button"
                aria-pressed={on}
                disabled={spent}
                title={spent ? 'Included because it has a spend limit' : undefined}
                onClick={() => toggleAsset(asset.symbol)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border pr-3 pl-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default aria-pressed:border-[var(--ws-accent-border)] aria-pressed:bg-[var(--harbor-accent-tint)] aria-pressed:text-[var(--ws-accent-ink)]"
              >
                <AssetIcon symbol={asset.symbol} className="size-[18px]" />
                {asset.symbol}
              </button>
            );
          })}
        </div>
      </PolicySection>

      <PolicySection
        title="Your own addresses"
        note={`Funds only ever go to ${wallet.address ?? 'your NEAR account'} and the addresses you add here. A destination outside this list is blocked, whatever a model, a feed or a post says.`}
      >
        {draft.destinations.map((destination, index) => (
          <div
            key={`destination-${index}`}
            className="grid gap-3 @xl/workspace:col-span-2 @xl/workspace:grid-cols-[180px_1fr_auto]"
          >
            <Select
              value={destination.chain}
              onValueChange={(chain) =>
                chain !== null &&
                update({
                  destinations: draft.destinations.map((entry, at) =>
                    at === index ? { ...entry, chain: String(chain) } : entry,
                  ),
                })
              }
            >
              <SelectTrigger
                aria-label="Chain"
                className="h-10 w-full gap-2.5 rounded-md border-input bg-card pr-3 pl-2.5 text-[13.5px] font-medium data-[size=default]:h-10"
              >
                <SelectValue>
                  <ChainChoice chain={destination.chain} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="min-w-56 p-1.5">
                {CHAINS.map((chain) => (
                  <SelectItem key={chain.value} value={chain.value} className="min-h-10 rounded-md py-2 pr-9 pl-2.5">
                    <ChainChoice chain={chain.value} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Address"
              className="h-10 font-mono text-[12.5px]"
              placeholder={
                destination.chain === 'near' ? 'savings.near' : destination.chain === 'sol' ? 'Solana address' : '0x…'
              }
              value={destination.address}
              onChange={(event) =>
                update({
                  destinations: draft.destinations.map((entry, at) =>
                    at === index ? { ...entry, address: event.target.value.trim() } : entry,
                  ),
                })
              }
            />
            <Button
              variant="ghost"
              className="h-10 w-10 p-0"
              aria-label="Remove this address"
              onClick={() => update({ destinations: draft.destinations.filter((_, at) => at !== index) })}
            >
              <X />
            </Button>
          </div>
        ))}
        <div className="@xl/workspace:col-span-2">
          <Button
            variant="outline"
            className="h-9 gap-2 px-3"
            disabled={draft.destinations.length >= 16}
            onClick={() => update({ destinations: [...draft.destinations, { chain: 'base', address: '' }] })}
          >
            <Plus /> Add an address
          </Button>
        </div>
      </PolicySection>

      <PolicySection title="Execution">
        <Field id={`${id}-slippage`} label="Slippage limit">
          <UnitInput id={`${id}-slippage`} unit="%" inputMode="decimal" value={slippage} onChange={setSlippage} />
        </Field>
        <Field id={`${id}-quote-age`} label="Oldest quote accepted">
          <UnitInput
            id={`${id}-quote-age`}
            unit="seconds"
            inputMode="numeric"
            value={String(draft.quoteMaxAgeSeconds)}
            onChange={(value) => update({ quoteMaxAgeSeconds: Number(value) || 0 })}
          />
        </Field>
        <Field id={`${id}-every`} label="The agent may act at most every">
          <UnitInput
            id={`${id}-every`}
            unit={draft.agentEveryHours === null ? '' : 'hours'}
            inputMode="numeric"
            disabled={draft.agentEveryHours === null}
            value={draft.agentEveryHours === null ? '' : String(draft.agentEveryHours)}
            onChange={(value) => update({ agentEveryHours: Number(value) || 1 })}
          />
        </Field>
        <Field id={`${id}-expiry`} label="Policy expires after">
          <UnitInput
            id={`${id}-expiry`}
            unit="days"
            inputMode="numeric"
            value={String(draft.expiresInDays)}
            onChange={(value) => update({ expiresInDays: Number(value) || 0 })}
          />
        </Field>
        <div className="@xl/workspace:col-span-2">
          <Toggle
            checked={draft.agentEveryHours === null}
            onChange={(once) => update({ agentEveryHours: once ? null : 24 })}
          >
            Let the agent act only once
          </Toggle>
        </div>
      </PolicySection>

      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        className="h-11 w-full justify-between px-4 text-[14px]"
        disabled={phase === 'signing' || !wallet.address}
        onClick={sign}
      >
        {phase === 'signing' ? (
          <>
            Waiting for your wallet… <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          </>
        ) : (
          <>
            {current ? `Sign revision ${current.revision + 1} in your wallet` : 'Sign policy in your wallet'}{' '}
            <ArrowRight />
          </>
        )}
      </Button>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Your wallet shows these limits in words with the policy's digest. Signing moves no funds.
      </p>
    </div>
  );
}
