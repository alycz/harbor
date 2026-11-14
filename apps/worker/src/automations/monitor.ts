import type { MonitorKind } from './config.ts';
import { evaluatePriceAlert, evaluateSpreadAlert } from './evaluate.ts';
import { type AutomationDeps, parseConfig } from './rules.ts';

/** Both scheduled conditions share leases, revisions, cooldowns, evidence and alert dedupe. */
export async function evaluateMonitor(deps: AutomationDeps, kind: MonitorKind, value: unknown) {
  const config = parseConfig(value, kind);
  if ('base' in config) {
    if (!deps.reference)
      return { result: 'unknown' as const, reason: 'Rhea reference quotes unavailable.', evidence: null };
    return evaluateSpreadAlert(config, { intents: deps.quotes, rhea: deps.reference });
  }
  if (!('sellAssetId' in config)) return evaluatePriceAlert(config, deps.quotes);
  if (!deps.roundtrip)
    return { result: 'unknown' as const, reason: 'Round-trip quotes are unavailable.', evidence: null };
  try {
    const preview = await deps.roundtrip(config);
    return {
      result:
        preview.status === 'opportunity'
          ? ('true' as const)
          : preview.status === 'below_threshold'
            ? ('false' as const)
            : ('unknown' as const),
      reason: preview.reason,
      evidence: preview,
    };
  } catch {
    return {
      result: 'unknown' as const,
      reason: 'Round-trip quotes are unavailable or the assets are no longer supported.',
      evidence: null,
    };
  }
}
