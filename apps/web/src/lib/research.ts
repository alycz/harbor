import { parseResearchSnapshot } from '@harbor/data/research';

import snapshotJson from '../../../../research/data/research-snapshot.json' with { type: 'json' };

/** The dated research snapshot: chains, protocols and yield pools, each citing its source. */
export const research = parseResearchSnapshot(snapshotJson);

/** Chains present in the snapshot's yield pools, most pools first. */
export function yieldChains(): string[] {
  const counts = new Map<string, number>();
  for (const pool of research.yieldPools) counts.set(pool.chain, (counts.get(pool.chain) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([chain]) => chain);
}

/** When the snapshot's newest source was captured, or null for an empty snapshot. */
export function capturedAt(): string | null {
  const times = research.sources.map((source) => source.capturedAt).sort();
  return times.at(-1) ?? null;
}
