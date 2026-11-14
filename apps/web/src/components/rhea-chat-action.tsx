import { RHEA_SYMBOLS, type RheaSymbol } from '../lib/lending.ts';
import { projectLogo } from '../lib/research-view.ts';
import { chainLogoUrl, LogoPair } from './protocol-logo.tsx';
import { RheaDepositFlow } from './rhea-deposit.tsx';

/** The verified NEAR token IDs the agent may name, mapped to the tokens Harbor supplies to Rhea. */
const RHEA_ASSET_IDS: Record<string, RheaSymbol> = {
  'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': 'USDC',
  'nep141:usdt.tether-token.near': 'USDT',
};

function symbolOf(asset: string): RheaSymbol | null {
  const upper = asset.toUpperCase();
  if ((RHEA_SYMBOLS as readonly string[]).includes(upper)) return upper as RheaSymbol;
  return RHEA_ASSET_IDS[asset] ?? null;
}

/**
 * A Rhea supply the agent suggested in chat. It is not an approval: it opens the same owner flow as
 * Earn, prefilled, and nothing moves until the owner reviews, approves and signs in their wallet.
 */
export function RheaChatAction({ assetId, amount }: { assetId: string; amount: string }) {
  const symbol = symbolOf(assetId);
  return (
    <section className="ws-card p-4" aria-label="Rhea Lend deposit">
      <div className="mb-3.5 flex items-center gap-3">
        <LogoPair
          className="size-8"
          primary={{ name: 'Rhea Lend', url: projectLogo('rhea-lend') }}
          secondary={{ name: 'NEAR', url: chainLogoUrl('NEAR') }}
        />
        <div>
          <p className="text-[14px] font-medium">Supply {symbol ?? 'a token'} on Rhea Lend</p>
          <p className="text-[12.5px] text-muted-foreground">Suggested in chat. Nothing moves until you sign.</p>
        </div>
      </div>
      {symbol ? (
        <RheaDepositFlow key={`${symbol}:${amount}`} symbol={symbol} initialAmount={amount} />
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Harbor supplies USDC and USDT to Rhea; this token is not one of them.
        </p>
      )}
    </section>
  );
}
