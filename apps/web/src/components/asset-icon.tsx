import { chainLogoUrl, LogoPair, splitAssetSymbol } from './protocol-logo.tsx';

const TOKEN_ICONS: Record<string, string> = {
  NEAR: chainLogoUrl('near'),
  ETH: chainLogoUrl('ethereum'),
  WETH: chainLogoUrl('ethereum'),
  SOL: chainLogoUrl('solana'),
  BTC: chainLogoUrl('bitcoin'),
  WBTC: chainLogoUrl('bitcoin'),
  USDC: 'https://icons.llamao.fi/icons/pegged/usd-coin?w=64&h=64',
  USDT: 'https://icons.llamao.fi/icons/pegged/usdt?w=64&h=64',
  DAI: 'https://icons.llamao.fi/icons/pegged/dai?w=64&h=64',
};

/** A swap asset's mark; a bridged one (USDC.arb) carries its chain as a small badge. */
export function AssetIcon({ symbol, className = 'size-9' }: { symbol: string; className?: string }) {
  const { token, chain } = splitAssetSymbol(symbol);
  return (
    <LogoPair
      className={className}
      primary={{ name: token, url: TOKEN_ICONS[token.toUpperCase()] }}
      secondary={chain ? { name: chain, url: chainLogoUrl(chain) } : null}
    />
  );
}
