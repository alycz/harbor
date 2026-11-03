import { type ExecutionDeps, loadPlan, transition } from './store.ts';

const MAX_PLANS_PER_TICK = 25;

/**
 * Expires approvals whose window closed without a signature. Never builds, signs or submits
 * anything; a plan that may have reached the network is left for its receipt to settle.
 */
export async function recoverPendingPlans(deps: ExecutionDeps) {
  const summary = { checked: 0, expired: 0 };
  const { results } = await deps.db
    .prepare(
      `SELECT id FROM plans WHERE network = ? AND status = 'awaiting_signature' AND tx_hash IS NULL
       AND valid_until_ms IS NOT NULL AND valid_until_ms <= ? ORDER BY updated_at_ms, id LIMIT ?`,
    )
    .bind(deps.config.network, deps.now(), MAX_PLANS_PER_TICK)
    .all<{ id: string }>();
  for (const row of results) {
    summary.checked += 1;
    const plan = await loadPlan(deps, row.id);
    if (plan.status !== 'awaiting_signature' || plan.tx_hash !== null) continue;
    const moved = await transition(
      deps,
      plan,
      'expired',
      { error_code: 'APPROVAL_EXPIRED' },
      'system',
      'Approval window closed before signing',
    );
    if (moved) summary.expired += 1;
  }
  return summary;
}
