import { Button } from '@harbor/ui/components/button';
import { Input } from '@harbor/ui/components/input';
import { Link } from '@tanstack/react-router';
import { ArrowRight, LoaderCircle, Vault } from 'lucide-react';
import { useId, useState } from 'react';

import { ExecutionRequestError, execution } from '../lib/execution.ts';
import { research } from '../lib/research.ts';
import { useWallet } from '../lib/wallet.tsx';
import { SwapProposalCard } from './swap-proposal.tsx';
import { Chip, Panel } from './workspace.tsx';

/** Vaults 1Click Earn reaches from USDC on NEAR: buying the receipt token deposits into the vault. */
const VAULTS = [
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
    snapshot: null,
  },
] as const;

const MIN_USDC = 50;

/** The vault's rate in the dated snapshot, as a range when the snapshot lists it more than once. */
function snapshotRate(match: { chain: string; symbol: string } | null): string {
  if (!match) return 'Not in the snapshot';
  const rates = research.yieldPools
    .filter((pool) => pool.chain === match.chain && pool.symbol.toUpperCase() === match.symbol)
    .map((pool) => pool.totalApyPct)
    .filter((rate): rate is number => rate !== null)
    .sort((a, b) => a - b);
  if (rates.length === 0) return 'Not in the snapshot';
  const low = rates[0]?.toFixed(2);
  const high = rates.at(-1)?.toFixed(2);
  return low === high ? `${low}% APY` : `${low}–${high}% APY`;
}

/**
 * Deposits USDC held on NEAR into a yield vault on another chain, through NEAR Intents. It is a swap
 * into the vault's receipt token, so it runs every check a swap does: delivery only to your own address
 * on that chain, your signed policy, your signature, and the delivery verified on that chain.
 */
export function EarnVaults() {
  return (
    <Panel label="Deposit through NEAR Intents" icon={<Vault />} labelId="earn-vaults" bodyClassName="p-5">
      <p className="mb-4 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
        Pay with USDC on NEAR; the vault's receipt token is delivered to your own address on its chain. Add that address
        to{' '}
        <Link to="/settings/policy" className="ws-link">
          your policy
        </Link>{' '}
        first. Withdrawals happen on the vault's own chain.
      </p>
      <ul className="grid gap-4 @3xl/workspace:grid-cols-2">
        {VAULTS.map((vault) => (
          <VaultCard key={vault.receipt} vault={vault} />
        ))}
      </ul>
    </Panel>
  );
}

function VaultCard({ vault }: { vault: (typeof VAULTS)[number] }) {
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
    <li className="ws-card flex flex-col gap-3.5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[14.5px] font-medium">{vault.name}</p>
          <p className="text-[12.5px] text-muted-foreground">
            {vault.protocol} on {vault.chain} · receipt token {vault.receipt}
          </p>
        </div>
        <Chip tone="accent">{snapshotRate(vault.snapshot)}</Chip>
      </div>
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
    </li>
  );
}
