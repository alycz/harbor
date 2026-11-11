import { parseResearchSnapshot } from '@harbor/data/research';

import snapshotJson from '../../../../research/data/research-snapshot.json' with { type: 'json' };

/** The dated research snapshot: chains, protocols and yield pools, each citing its source. */
export const research = parseResearchSnapshot(snapshotJson);

/** Where the snapshot's figures come from and when they were captured: shown wherever they are. */
export function snapshotCredit(): string {
  const captured = research.sources
    .map((source) => source.capturedAt)
    .filter(Boolean)
    .sort()
    .at(0);
  const names = [...new Set(research.sources.map((source) => source.name))].join(', ');
  return captured
    ? `${names} · captured ${new Date(captured).toUTCString().slice(5, 22)} UTC · a dated snapshot, not live rates`
    : 'No snapshot captured yet';
}
