import type { YieldPoolRow } from '@harbor/data/research';
import { Button } from '@harbor/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@harbor/ui/components/dialog';
import { Input } from '@harbor/ui/components/input';
import { Link } from '@tanstack/react-router';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useId, useState } from 'react';

import { ExecutionRequestError, execution } from '../lib/execution.ts';
import { useWallet } from '../lib/wallet.tsx';
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

/**
 * Deposits USDC held on NEAR into a yield vault on another chain, through NEAR Intents. It is a swap
 * into the vault's receipt token, so it runs every check a swap does: delivery only to your own address
 * on that chain, your signed policy, your signature, and the delivery verified on that chain.
 */
export function DepositDialog({ vault, onOpenChange }: { vault: Vault | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={vault !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-4">
        {vault ? (
          <>
            <DialogTitle className="font-display text-[22px] leading-tight">Deposit into {vault.name}</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              Pay with USDC on NEAR; the vault's receipt token is delivered to your own address on {vault.chain}. Add
              that address to{' '}
              <Link to="/settings/policy" className="ws-link">
                your policy
              </Link>{' '}
              first. Withdrawals happen on the vault's own chain.
            </DialogDescription>
            <VaultCard vault={vault} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function VaultCard({ vault }: { vault: Vault }) {
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

  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-[12.5px] text-muted-foreground">
        {vault.protocol} on {vault.chain} · receipt token {vault.receipt}
      </p>
      {intentId ? (
        <SwapProposalCard intentId={intentId} />
      ) : (
        <div className="flex flex-wrap items-end gap-2.5">
          <label htmlFor={`${id}-amount`} className="min-w-0 flex-1 space-y-1.5 text-[12.5px] text-muted-foreground">
            USDC on NEAR to deposit
            <Input
              id={`${id}-amount`}
              className="h-10"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value.trim())}
            />
          </label>
          {wallet.address ? (
            <Button className="h-10 gap-2 px-4" onClick={prepare} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
              Get a quote <ArrowRight />
            </Button>
          ) : (
            <Button className="h-10 px-4" onClick={wallet.connect} disabled={wallet.connecting}>
              Connect wallet
            </Button>
          )}
        </div>
      )}
      {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * A pool Harbor has no deposit path into yet. Says so plainly, and offers what does work: depositing
 * into a vault Harbor supports.
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
  return (
    <Dialog open={pool !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] gap-4">
        {pool ? (
          <>
            <DialogTitle className="font-display text-[22px] leading-tight">
              Deposits into {pool.symbol} on {pool.chain} are not live yet
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              Harbor only moves funds where it can check every step: your policy, your signature and the delivery on
              chain. This pool does not have that path yet. You can deposit into these vaults today:
            </DialogDescription>
            <div className="flex flex-wrap gap-2.5">
              {VAULTS.map((vault) => (
                <Button key={vault.receipt} className="h-10 gap-2 px-4" onClick={() => onDeposit(vault)}>
                  {vault.name} <ArrowRight />
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
