import type { YieldPoolRow } from '@harbor/data/research';
import { Button } from '@harbor/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@harbor/ui/components/dialog';
import { Input } from '@harbor/ui/components/input';
import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight, ChevronRight, LoaderCircle } from 'lucide-react';
import { useId, useState } from 'react';

import { ExecutionRequestError, execution } from '../lib/execution.ts';
import { formatApy } from '../lib/format.ts';
import { research } from '../lib/research.ts';
import { projectLogo, projectName } from '../lib/research-view.ts';
import { useWallet } from '../lib/wallet.tsx';
import { ChainLogo, chainLogoUrl, LogoPair } from './protocol-logo.tsx';
import { SwapProposalCard } from './swap-proposal.tsx';

/** Vaults 1Click Earn reaches from USDC on NEAR: buying the receipt token deposits into the vault. */
export const VAULTS = [
  {
    receipt: 'gtUSDCp',
    name: 'Gauntlet USDC Prime',
    protocol: 'Morpho',
    chain: 'Base',
    chainCode: 'base',
    snapshot: { chain: 'Base', symbol: 'GTUSDCP' },
  },
  {
    receipt: 'TLO',
    name: 'Taler USDC',
    protocol: 'Taler',
    chain: 'Ethereum',
    chainCode: 'eth',
    snapshot: { chain: 'Ethereum', symbol: 'TLO' },
  },
] as const;

const MIN_USDC = 50;

/** The vault a snapshot pool is, when Harbor can deposit into it. */
export function vaultForPool(pool: YieldPoolRow): Vault | null {
  return (
    VAULTS.find(
      (vault) => vault.snapshot.chain === pool.chain && vault.snapshot.symbol === pool.symbol.toUpperCase(),
    ) ?? null
  );
}

export type Vault = (typeof VAULTS)[number];

/** The vault's largest listing in the research snapshot, if it has one. */
export function vaultListing(vault: Vault): YieldPoolRow | null {
  return (
    research.yieldPools
      .filter((pool) => pool.chain === vault.snapshot.chain && pool.symbol.toUpperCase() === vault.snapshot.symbol)
      .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0] ?? null
  );
}

function vaultApy(vault: Vault): string {
  const listing = vaultListing(vault);
  return listing ? `${formatApy(listing.totalApyPct)} APY` : 'Rate not listed';
}

/**
 * Deposits USDC held on NEAR into a yield vault on another chain, through NEAR Intents. It is a swap
 * into the vault's receipt token, so it runs every check a swap does: delivery only to your own address
 * on that chain, your signed policy, your signature, and the delivery verified on that chain.
 */
export function DepositDialog({ vault, onOpenChange }: { vault: Vault | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={vault !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] gap-0 p-0">
        {vault ? (
          <>
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-center gap-3.5 pr-8">
                <ChainLogo chain={vault.chain} className="size-10" />
                <div className="min-w-0">
                  <DialogTitle className="font-display text-[22px] leading-tight">{vault.name}</DialogTitle>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {vault.protocol} on {vault.chain} · {vaultApy(vault)}
                  </p>
                </div>
              </div>
              <DialogDescription className="mt-4 text-[13.5px] leading-relaxed">
                Pay with USDC on NEAR and receive {vault.receipt} at your own address on {vault.chain}. Add that address
                to{' '}
                <Link to="/settings/policy" className="ws-link">
                  your policy
                </Link>{' '}
                first. Withdrawals happen on {vault.chain}.
              </DialogDescription>
            </div>
            <div className="border-t border-border px-6 pt-5 pb-6">
              <DepositForm vault={vault} />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DepositForm({ vault }: { vault: Vault }) {
  const id = useId();
  const wallet = useWallet();
  const [amount, setAmount] = useState(String(MIN_USDC));
  const [intentId, setIntentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setError(null);
    if (!(Number(amount) >= MIN_USDC)) {
      setError(`NEAR Intents reaches this vault from about ${MIN_USDC} USDC.`);
      return;
    }
    setBusy(true);
    try {
      const intent = await execution.createSwap({ sellAsset: 'USDC', buyAsset: vault.receipt, sellAmount: amount });
      setIntentId(intent.id);
    } catch (caught) {
      setError(caught instanceof ExecutionRequestError ? caught.message : 'The deposit could not be prepared.');
    } finally {
      setBusy(false);
    }
  }

  if (intentId) return <SwapProposalCard intentId={intentId} />;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-amount`} className="text-[12.5px] font-medium text-muted-foreground">
        Amount
      </label>
      <div className="flex items-stretch gap-2.5">
        <div className="relative min-w-0 flex-1">
          <Input
            id={`${id}-amount`}
            className="h-11 pr-16 text-[15px]"
            inputMode="decimal"
            value={amount}
            aria-describedby={`${id}-hint`}
            onChange={(event) => setAmount(event.target.value.trim())}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[13px] text-muted-foreground">
            USDC
          </span>
        </div>
        {wallet.address ? (
          <Button className="h-11 gap-2 px-4" onClick={prepare} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
            Get a quote <ArrowRight />
          </Button>
        ) : (
          <Button className="h-11 px-4" onClick={wallet.connect} disabled={wallet.connecting}>
            {wallet.connecting ? 'Connecting…' : 'Connect wallet'}
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className="text-[12.5px] text-muted-foreground">
        USDC on NEAR · minimum about {MIN_USDC} USDC
      </p>
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A pool Harbor has no deposit path into yet. Says so plainly, and offers what does work: depositing
 * into a vault Harbor supports, or asking Harbor about this pool.
 */
export function NotYetDialog({
  pool,
  onOpenChange,
  onDeposit,
}: {
  pool: YieldPoolRow | null;
  onOpenChange: (open: boolean) => void;
  onDeposit: (vault: Vault) => void;
}) {
  const name = pool ? projectName(pool.project) : '';
  return (
    <Dialog open={pool !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] gap-0 p-0">
        {pool ? (
          <>
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-center gap-3.5 pr-8">
                <LogoPair
                  className="size-10"
                  primary={{ name, url: projectLogo(pool.project) }}
                  secondary={{ name: pool.chain, url: chainLogoUrl(pool.chain) }}
                />
                <div className="min-w-0">
                  <DialogTitle className="font-display text-[22px] leading-tight">{name}</DialogTitle>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {pool.symbol} on {pool.chain} · {formatApy(pool.totalApyPct)} APY
                  </p>
                </div>
              </div>
              <DialogDescription className="mt-4 text-[13.5px] leading-relaxed">
                Deposits into {name} aren't live in Harbor yet. Harbor only moves funds where it can check every step:
                your policy, your signature and the delivery on chain.
              </DialogDescription>
            </div>
            <div className="border-t border-border px-6 pt-5 pb-6">
              <p className="text-[12.5px] font-medium text-muted-foreground">Deposit today instead</p>
              <ul className="mt-2.5 flex flex-col gap-2">
                {VAULTS.map((vault) => (
                  <li key={vault.receipt}>
                    <button
                      type="button"
                      onClick={() => onDeposit(vault)}
                      className="group flex w-full items-center gap-3 rounded-[10px] border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-[var(--harbor-border-strong)] hover:bg-[var(--harbor-accent-tint)]"
                    >
                      <ChainLogo chain={vault.chain} className="size-8" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium">{vault.name}</span>
                        <span className="block text-[12.5px] text-muted-foreground">
                          {vault.protocol} on {vault.chain}
                        </span>
                      </span>
                      <span className="ws-num text-[13.5px] font-medium">{vaultApy(vault)}</span>
                      <ChevronRight
                        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
              <Link
                to="/chat"
                search={{
                  ask: `I want to deposit into ${pool.symbol} on ${name} (${pool.chain}). What are the risks and how would I do it?`,
                }}
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ws-accent-ink)] hover:underline"
              >
                Ask Harbor about {name} <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
