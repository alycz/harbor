import { AmountError, MAX_U128_RAW, parseDecimalAmount, rawToText } from '@harbor/domain/amount';
import { AppError } from '@harbor/domain/errors';
import { type ExecutionDeps, loadIntent, logFailure } from '../execution/store.ts';
import { createSwapIntent, swapIntentView } from '../execution/swap.ts';
import { loadSignedPolicy } from '../policy/policies.ts';

const MAX_PER_TICK = 25;
const MAX_STRATEGIES = 10;

interface StrategyRow {
  id: string;
  network: string;
  owner_account: string;
  kind: 'dca';
  sell_asset: string;
  buy_asset: string;
  amount_raw: string;
  every_seconds: number;
  status: 'active' | 'paused' | 'deleted';
  next_run_at_ms: number | null;
  last_run_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

/** A recurring buy: sell `amount` of one asset for another, at most once per interval. */
export async function createStrategy(
  deps: ExecutionDeps,
  owner: string,
  input: { sell: string; buy: string; amount: string; everyHours: number },
) {
  const sell = deps.assets.bySymbol(input.sell);
  const buy = deps.assets.bySymbol(input.buy);
  if (!sell || !buy || sell.canonicalId === buy.canonicalId) {
    throw new AppError('INVALID_REQUEST', 'Choose two different supported assets.');
  }
  if (sell.chain !== 'near') throw new AppError('INVALID_REQUEST', 'The agent can only spend assets held on NEAR.');
  let raw: bigint;
  try {
    raw = parseDecimalAmount(input.amount, sell.decimals, MAX_U128_RAW);
  } catch (error) {
    throw new AppError('INVALID_REQUEST', error instanceof AmountError ? error.message : 'Enter a valid amount.');
  }
  if (raw === 0n) throw new AppError('INVALID_REQUEST', 'Enter an amount above zero.');
  const count = await deps.db
    .prepare("SELECT COUNT(*) AS count FROM strategies WHERE network = ? AND owner_account = ? AND status != 'deleted'")
    .bind(deps.config.network, owner)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= MAX_STRATEGIES)
    throw new AppError('CONFLICT', 'You already have the most strategies allowed.');
  const now = deps.now();
  const id = crypto.randomUUID();
  await deps.db
    .prepare(
      `INSERT INTO strategies (id, network, owner_account, kind, sell_asset, buy_asset, amount_raw, every_seconds, status,
         next_run_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'dca', ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .bind(
      id,
      deps.config.network,
      owner,
      sell.canonicalId,
      buy.canonicalId,
      rawToText(raw),
      input.everyHours * 3_600,
      now,
      now,
      now,
    )
    .run();
  return listStrategies(deps, owner);
}

export async function listStrategies(deps: ExecutionDeps, owner: string) {
  const { results } = await deps.db
    .prepare(
      `SELECT * FROM strategies WHERE network = ? AND owner_account = ? AND status != 'deleted' ORDER BY created_at_ms DESC`,
    )
    .bind(deps.config.network, owner)
    .all<StrategyRow>();
  return {
    strategies: results.map((row) => {
      const sell = deps.assets.byId(row.sell_asset);
      const buy = deps.assets.byId(row.buy_asset);
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        sell: sell?.symbol ?? row.sell_asset,
        buy: buy?.symbol ?? row.buy_asset,
        amount: sell ? formatRaw(row.amount_raw, sell.decimals) : row.amount_raw,
        everyHours: row.every_seconds / 3_600,
        nextRunAt:
          row.status === 'active' && row.next_run_at_ms !== null ? new Date(row.next_run_at_ms).toISOString() : null,
        lastRunAt: row.last_run_at_ms === null ? null : new Date(row.last_run_at_ms).toISOString(),
      };
    }),
  };
}

export async function setStrategyStatus(
  deps: ExecutionDeps,
  owner: string,
  id: string,
  status: 'active' | 'paused' | 'deleted',
) {
  const now = deps.now();
  const result = await deps.db
    .prepare(
      `UPDATE strategies SET status = ?, next_run_at_ms = CASE WHEN ? = 'active' THEN ? ELSE next_run_at_ms END,
         updated_at_ms = ? WHERE id = ? AND network = ? AND owner_account = ? AND status != 'deleted'`,
    )
    .bind(status, status, now, now, id, deps.config.network, owner)
    .run();
  if (result.meta.changes !== 1) throw new AppError('NOT_FOUND', 'No such strategy.');
  return listStrategies(deps, owner);
}

/**
 * The cron's autopilot pass. A due strategy queues one action for its owner, only while the owner has
 * an active, unfrozen, unexpired signed policy; otherwise the run is skipped with the reason. The
 * action is an intent like any other: its plan still passes the owner's policy, schedule included.
 */
export async function runAutopilot(deps: ExecutionDeps) {
  const summary = { due: 0, queued: 0, skipped: 0 };
  const now = deps.now();
  const { results } = await deps.db
    .prepare(
      `SELECT * FROM strategies WHERE network = ? AND status = 'active' AND next_run_at_ms <= ?
       ORDER BY next_run_at_ms LIMIT ?`,
    )
    .bind(deps.config.network, now, MAX_PER_TICK)
    .all<StrategyRow>();
  for (const strategy of results) {
    summary.due += 1;
    // Claim this run first, so overlapping ticks never queue it twice.
    const claimed = await deps.db
      .prepare(
        `UPDATE strategies SET next_run_at_ms = ?, last_run_at_ms = ?, updated_at_ms = ?
         WHERE id = ? AND status = 'active' AND next_run_at_ms = ?`,
      )
      .bind(now + strategy.every_seconds * 1000, now, now, strategy.id, strategy.next_run_at_ms)
      .run();
    if (claimed.meta.changes !== 1) continue;
    try {
      const policy = await loadSignedPolicy(deps.db, deps.config.network, strategy.owner_account);
      const live = policy?.status === 'active' && now < Date.parse(policy.body.expiresAt);
      if (!live) {
        summary.skipped += 1;
        await recordRun(
          deps,
          strategy,
          null,
          'skipped',
          policy ? 'The signed policy is frozen or expired.' : 'No signed policy.',
        );
        continue;
      }
      const sell = deps.assets.byId(strategy.sell_asset);
      const buy = deps.assets.byId(strategy.buy_asset);
      if (!sell || !buy) {
        summary.skipped += 1;
        await recordRun(deps, strategy, null, 'skipped', 'An asset is no longer supported.');
        continue;
      }
      const intent = await createSwapIntent(deps, {
        sell: sell.symbol,
        buy: buy.symbol,
        amount: formatRaw(strategy.amount_raw, sell.decimals),
        source: 'autopilot',
      });
      summary.queued += 1;
      await recordRun(
        deps,
        strategy,
        intent.id,
        'queued',
        'Queued under the signed policy; waiting for your signature.',
      );
    } catch (error) {
      logFailure('autopilot', error);
      await recordRun(deps, strategy, null, 'skipped', 'The action could not be prepared.').catch(() => undefined);
    }
  }
  return summary;
}

/** The actions the agent queued for this owner and that still wait for them. */
export async function listQueue(deps: ExecutionDeps, owner: string) {
  const { results } = await deps.db
    .prepare(
      `SELECT * FROM autopilot_runs WHERE owner_account = ? AND status = 'queued' AND intent_id IS NOT NULL
         AND intent_id NOT IN (
           SELECT intent_id FROM plans WHERE account_id = ? AND status IN
             ('awaiting_signature', 'submitted', 'confirming', 'confirmed', 'refunded', 'failed', 'outcome_unknown'))
       ORDER BY created_at_ms DESC LIMIT 10`,
    )
    .bind(owner, owner)
    .all<{ id: string; intent_id: string; reason: string; created_at_ms: number }>();
  return {
    queue: await Promise.all(
      results.map(async (run) => ({
        id: run.id,
        queuedAt: new Date(run.created_at_ms).toISOString(),
        reason: run.reason,
        intent: swapIntentView(deps, await loadIntent(deps, run.intent_id)),
      })),
    ),
  };
}

export async function dismissRun(deps: ExecutionDeps, owner: string, id: string) {
  const result = await deps.db
    .prepare(
      "UPDATE autopilot_runs SET status = 'dismissed', updated_at_ms = ? WHERE id = ? AND owner_account = ? AND status = 'queued'",
    )
    .bind(deps.now(), id, owner)
    .run();
  if (result.meta.changes !== 1) throw new AppError('NOT_FOUND', 'No such queued action.');
  return listQueue(deps, owner);
}

async function recordRun(
  deps: ExecutionDeps,
  strategy: StrategyRow,
  intentId: string | null,
  status: 'queued' | 'skipped',
  reason: string,
) {
  const now = deps.now();
  await deps.db
    .prepare(
      `INSERT INTO autopilot_runs (id, strategy_id, owner_account, intent_id, status, reason, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), strategy.id, strategy.owner_account, intentId, status, reason, now, now)
    .run();
}

function formatRaw(raw: string, decimals: number): string {
  const digits = raw.padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
