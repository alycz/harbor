import { safeResearchUrl } from '@harbor/data/research';
import { useState } from 'react';

/*
 * Real marks only (Stageshow: never a letter in a coloured square standing in for a logo). Chains,
 * protocols and the swap assets come from DefiLlama's icon CDN, the same source as the research
 * snapshot; when one fails to load, a quiet disc with the initials holds its place.
 */

const ICONS = 'https://icons.llamao.fi/icons';

/** The chain icon for a chain's display name, as DefiLlama names it ("BNB Chain" → rsz_bnb chain). */
export function chainLogoUrl(chain: string): string {
  return `${ICONS}/chains/rsz_${encodeURIComponent(chain.toLowerCase())}.jpg`;
}

/** A protocol's icon by its DefiLlama slug ("aave-v3"). */
export function protocolLogoUrl(slug: string): string {
  return `${ICONS}/protocols/${encodeURIComponent(slug)}?w=64&h=64`;
}

/** The chains a bridged symbol's suffix names: USDC.arb is USDC on Arbitrum. */
const SUFFIX_CHAINS: Record<string, string> = {
  arb: 'Arbitrum',
  base: 'Base',
  eth: 'Ethereum',
  sol: 'Solana',
  op: 'Optimism',
  bsc: 'BNB Chain',
  poly: 'Polygon',
  avax: 'Avalanche',
};

/** Splits "USDC.arb" into the token and the chain its suffix names. */
export function splitAssetSymbol(symbol: string): { token: string; chain: string | null } {
  const [token = symbol, suffix] = symbol.split('.');
  return { token, chain: suffix ? (SUFFIX_CHAINS[suffix.toLowerCase()] ?? null) : null };
}

/** One round mark from a URL, or the name's initials on a quiet disc when there is none. */
export function ProtocolLogo({
  name,
  fallback,
  className = 'size-8',
}: {
  name: string;
  fallback?: string | undefined;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = safeResearchUrl(fallback ?? '');
  const visible = Boolean(src && src !== failedSrc);
  return (
    <span
      aria-hidden="true"
      data-logo-name={name}
      data-logo-state={visible ? 'available' : 'missing'}
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full align-middle text-[0.4em] font-semibold tracking-tight uppercase ring-1 ring-[rgb(23_25_31/0.08)] ${visible ? 'bg-card' : 'bg-secondary text-muted-foreground'} ${className}`}
    >
      {src && visible ? (
        <img
          src={src}
          alt=""
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="text-[max(9px,0.42em)] leading-none">{name.replace(/[^a-z0-9]/gi, '').slice(0, 2)}</span>
      )}
    </span>
  );
}

/** A chain's mark by its display name. */
export function ChainLogo({ chain, className = 'size-5' }: { chain: string; className?: string }) {
  return <ProtocolLogo name={chain} fallback={chainLogoUrl(chain)} className={className} />;
}

/**
 * Royco's pair: a primary mark with a smaller one tucked over its lower-right edge, ringed in the
 * surface colour so the two read as one object.
 */
export function LogoPair({
  primary,
  secondary,
  className = 'size-8',
}: {
  primary: { name: string; url?: string | undefined };
  secondary?: { name: string; url?: string | undefined } | null | undefined;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={`relative inline-block shrink-0 ${className}`}>
      <ProtocolLogo name={primary.name} fallback={primary.url} className="size-full" />
      {secondary ? (
        <span className="absolute -right-1 -bottom-1 size-[52%] rounded-full bg-card p-px">
          <ProtocolLogo name={secondary.name} fallback={secondary.url} className="size-full" />
        </span>
      ) : null}
    </span>
  );
}
