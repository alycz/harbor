import { parseResearchSnapshot } from '@harbor/data/research';

import snapshotJson from '../../../../research/data/research-snapshot.json' with { type: 'json' };

/** The dated research snapshot: chains, protocols and yield pools, each citing its source. */
export const research = parseResearchSnapshot(snapshotJson);

/** When the snapshot's newest source was captured, or null for an empty snapshot. */
export function capturedAt(): string | null {
  const times = research.sources.map((source) => source.capturedAt).sort();
  return times.at(-1) ?? null;
}
