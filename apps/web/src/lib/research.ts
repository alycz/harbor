import { parseResearchSnapshot } from '@harbor/data/research';

import snapshotJson from '../../../../research/data/research-snapshot.json' with { type: 'json' };

/** The dated research snapshot: chains, protocols and yield pools, each citing its source. */
export const research = parseResearchSnapshot(snapshotJson);
