import type { YieldPoolRow } from '@harbor/data/research';

import { protocolLogoUrl } from '../components/protocol-logo.tsx';
import { research } from './research.ts';

/** The chain Harbor lives on; it leads every chain list. */
export const HOME_CHAIN = 'NEAR';

const PROTOCOL_NAMES = new Map(research.protocols.map((protocol) => [protocol.slug, protocol.name]));
const PROTOCOL_LOGOS = new Map(research.protocols.map((protocol) => [protocol.slug, protocol.logo]));

/** The name a person knows a pool's project by: the snapshot's protocol name, or its slug in words. */
export function projectName(slug: string): string {
  const known = PROTOCOL_NAMES.get(slug);
  if (known) return known;
  return slug
    .split('-')
    .map((part) => (/^v\d+$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/** The project's logo: the snapshot's own when it has one, else DefiLlama's icon for the slug. */
export function projectLogo(slug: string): string {
  return PROTOCOL_LOGOS.get(slug) ?? protocolLogoUrl(slug);
}

/** Chains that have pools in the snapshot, NEAR first and then by DeFi TVL. */
export function chainsWithPools() {
  const pools = new Map<string, number>();
  for (const pool of research.yieldPools) pools.set(pool.chain, (pools.get(pool.chain) ?? 0) + 1);
  return [...research.chains]
    .filter((chain) => pools.has(chain.name))
    .sort((a, b) =>
      a.name === HOME_CHAIN ? -1 : b.name === HOME_CHAIN ? 1 : (b.defiTvlUsd ?? 0) - (a.defiTvlUsd ?? 0),
    )
    .map((chain) => ({ name: chain.name, tvl: chain.defiTvlUsd, pools: pools.get(chain.name) ?? 0 }));
}

/** How a pool's current APY compares with its 30-day mean, in percentage points. */
export function apyDrift(pool: Pick<YieldPoolRow, 'totalApyPct' | 'mean30dApyPct'>): number | null {
  if (pool.totalApyPct === null || pool.mean30dApyPct === null) return null;
  return pool.totalApyPct - pool.mean30dApyPct;
}
