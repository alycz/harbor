import { isNearAccountId, isOnNetwork } from '@harbor/domain/account';
import { AppError } from '@harbor/domain/errors';
import {
  type ExecutionDeps,
  existingPlan,
  firstBlock,
  type IntentRow,
  insertPlan,
  loadIntent,
  loadOwnPlan,
  loadQuote,
  newPlanRow,
  type PlanRow,
  type QuoteRow,
  transitionOrReload,
} from './store.ts';
import { compareSwap, swapIntentView, swapPlanPolicy, swapPlanView } from './swap.ts';

const ACTIVITY_LIMIT = 30;
/** How long an approval stays usable before the plan must be reviewed again. */
const APPROVAL_WINDOW_MS = 5 * 60_000;

export async function readIntent(deps: ExecutionDeps, intentId: string) {
  return swapIntentView(deps, await loadIntent(deps, intentId));
}

/** Fresh quotes for an intent. */
export async function compareIntent(deps: ExecutionDeps, intentId: string) {
  return compareSwap(deps, await loadIntent(deps, intentId));
}

/** Runs the policy over an exact quote and records the plan, blocked or ready for review. */
export async function createPlan(
  deps: ExecutionDeps,
  input: { intentId: string; quoteId: string; accountId: string; idempotencyKey: string },
) {
  if (!isNearAccountId(input.accountId)) throw new AppError('INVALID_REQUEST', 'Connect a wallet to review this.');
  if (!isOnNetwork(input.accountId, deps.config.network)) {
    throw new AppError('INVALID_REQUEST', 'That account belongs to a different network.');
  }
  const existing = await existingPlan(deps, input);
  if (existing) return planView(deps, existing);

  const intent = await loadIntent(deps, input.intentId);
  const quote = await loadQuote(deps, input.quoteId);
  if (quote.intent_id !== intent.id) throw new AppError('INVALID_REQUEST', 'That quote belongs to another request.');
  const now = deps.now();
  const { decision, digest } = await swapPlanPolicy(intent, quote, input.accountId, now);
  const row = newPlanRow({
    intent,
    quoteId: quote.id,
    accountId: input.accountId,
    idempotencyKey: input.idempotencyKey,
    status: decision.verdict === 'block' ? 'blocked' : 'awaiting_review',
    digest,
    policy: JSON.stringify(decision),
    errorCode: firstBlock(decision),
    now,
  });
  await insertPlan(deps, row);
  return planView(deps, row);
}

/** The account's plans that reached the network, newest first. */
export async function listActivity(deps: ExecutionDeps, account: string) {
  if (!isNearAccountId(account)) throw new AppError('INVALID_REQUEST', 'Send a valid account ID.');
  const { results } = await deps.db
    .prepare(
      `SELECT * FROM plans WHERE network = ? AND account_id = ? AND tx_hash IS NOT NULL
       ORDER BY created_at_ms DESC LIMIT ?`,
    )
    .bind(deps.config.network, account, ACTIVITY_LIMIT)
    .all<PlanRow>();
  const intents = await rowsById<IntentRow>(
    deps,
    'intents',
    results.map((plan) => plan.intent_id),
  );
  const quotes = await rowsById<QuoteRow>(
    deps,
    'quotes',
    results.map((plan) => plan.quote_id),
  );
  return {
    network: deps.config.network,
    items: results.flatMap((plan) => {
      const intent = intents.get(plan.intent_id);
      const quote = quotes.get(plan.quote_id);
      return intent && quote ? [activityItem(deps, plan, intent, quote)] : [];
    }),
  };
}

export async function readPlan(deps: ExecutionDeps, planId: string, account: string) {
  return planView(deps, await loadOwnPlan(deps, planId, account));
}

/**
 * Records the account owner's review of exactly this plan. Approval binds the digest the user saw and
 * needs execution enabled on this server; it never signs or submits anything.
 */
export async function approvePlan(deps: ExecutionDeps, planId: string, account: string, input: { digest: string }) {
  const plan = await loadOwnPlan(deps, planId, account);
  if (plan.status !== 'awaiting_review') throw new AppError('CONFLICT', 'This plan is not waiting for review.');
  if (input.digest !== plan.digest) {
    throw new AppError('CONFLICT', 'The plan changed since you reviewed it. Review it again.');
  }
  const quote = await loadQuote(deps, plan.quote_id);
  if (!deps.config.executionEnabled || !deps.config.writeAdapters.has(quote.venue)) {
    throw new AppError('EXECUTION_DISABLED', 'Execution is turned off on this server. This plan is review-only.');
  }
  const now = deps.now();
  if (now >= quote.expires_at_ms) {
    return planView(
      deps,
      await transitionOrReload(deps, plan, 'expired', { error_code: 'QUOTE_EXPIRED' }, 'system', 'Quote expired'),
    );
  }
  const approved = await transitionOrReload(
    deps,
    plan,
    'awaiting_signature',
    { approved_at_ms: now, valid_until_ms: now + APPROVAL_WINDOW_MS },
    'user',
    'Reviewed and approved',
  );
  return planView(deps, approved);
}

async function planView(deps: ExecutionDeps, row: PlanRow) {
  return swapPlanView(deps, row, await loadIntent(deps, row.intent_id), await loadQuote(deps, row.quote_id));
}

/** One line of account activity: what left the account, where, and how it ended. */
function activityItem(deps: ExecutionDeps, plan: PlanRow, intent: IntentRow, quote: QuoteRow) {
  const view = swapPlanView(deps, plan, intent, quote);
  return {
    id: plan.id,
    kind: intent.kind,
    status: plan.status,
    createdAt: new Date(plan.created_at_ms).toISOString(),
    txHash: plan.tx_hash,
    explorerUrl: view.explorerUrl,
    errorCode: plan.error_code,
    title: `Swap ${view.quote.sell.symbol} → ${view.quote.expectedOut.symbol}`,
    venue: view.quote.venue,
    sent: [{ symbol: view.quote.sell.symbol, amount: view.quote.sell.amount }],
  };
}

async function rowsById<T extends { id: string }>(
  deps: ExecutionDeps,
  table: 'intents' | 'quotes',
  ids: readonly string[],
): Promise<Map<string, T>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { results } = await deps.db
    .prepare(`SELECT * FROM ${table} WHERE id IN (${unique.map(() => '?').join(', ')})`)
    .bind(...unique)
    .all<T>();
  return new Map(results.map((row) => [row.id, row]));
}
