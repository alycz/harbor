import { formatRawAmount, MAX_U128_RAW, parseDecimalAmount } from '@harbor/domain/amount';
import {
  claim,
  complete,
  enqueue,
  fail,
  failExhausted,
  type Lease,
  pruneFinished,
  Superseded,
} from '@harbor/jobs/jobs';
import { tokenContractOf } from '@harbor/near/chain';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';

import { decodeExecutionConfig } from '../config.ts';
import { type ExecutionDeps, executionDeps } from '../execution/store.ts';
import type { QuoteSource } from './evaluate.ts';
import { evaluateMonitor } from './monitor.ts';
import { previewRoundtrip } from './roundtrip.ts';
import type { AutomationDeps, RuleRow } from './rules.ts';

const JOB_KIND = 'automation.evaluate';
/** Long enough for a quote with its timeout; an expired lease lets another tick retry the check. */
const LEASE_MS = 45_000;
/** Finished jobs are dropped after this: claiming scans the table, so it has to stay small. */
const FINISHED_JOB_KEEP_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15_000;
/** Bounds one scheduled invocation so it stays inside the Worker's time and subrequest budgets. */
const MAX_RULES_PER_TICK = 25;
const MAX_EVALUATIONS_PER_TICK = 25;
const TICK_BUDGET_MS = 25_000;
/**
 * Cron ticks start a few seconds late, by a varying amount. A rule falling due within this much of a
 * tick runs on it, so jitter can never push a once-a-minute check to every other minute.
 */
const DUE_GRACE_MS = 30_000;
/** A scheduled Rhea read waits longer than a page's, and tries three times in all. */
const RHEA_TIMEOUT_MS = 8_000;
const RHEA_RETRY_PAUSES_MS = [0, 500, 1_500];

const JobPayloadSchema = z.strictObject({
  ruleId: z.uuid(),
  revision: z.number().int().positive(),
  scheduledForMs: z.number().int().nonnegative(),
  enqueuedAtMs: z.number().int().nonnegative().optional(),
});

export function automationDeps(env: Env): AutomationDeps {
  const config = decodeExecutionConfig(env);
  const execution = executionDeps(env);
  return {
    db: env.DB,
    network: config.network,
    now: Date.now,
    quotes: venueQuotes(execution),
    reference: rheaQuotes(execution),
    roundtrip: (config) => previewRoundtrip(execution, config),
  };
}

/** Reads a swap's price on Rhea's router: a price only, Harbor never executes there. NEAR tokens only. */
function rheaQuotes(deps: ExecutionDeps): QuoteSource {
  return {
    async read(request) {
      const router = deps.reference;
      if (!router) throw new Error('No Rhea router is configured.');
      const sell = deps.assets.byId(request.sellAssetId);
      const buy = deps.assets.byId(request.buyAssetId);
      if (!sell || !buy) throw new Error('This monitor names an asset Harbor does not support.');
      const tokenIn = tokenContractOf(sell.canonicalId);
      const tokenOut = tokenContractOf(buy.canonicalId);
      if (sell.chain !== 'near' || buy.chain !== 'near' || !tokenIn || !tokenOut) {
        throw new Error('Rhea prices NEAR tokens only.');
      }
      const amountIn = parseDecimalAmount(request.amount, sell.decimals, MAX_U128_RAW);
      // Rhea's router now and then times out or answers without a route from Cloudflare's network. A
      // scheduled check has time to spare, so it waits longer and retries twice before recording why.
      let reason = 'Rhea did not answer.';
      for (const pauseMs of RHEA_RETRY_PAUSES_MS) {
        if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
        const answer = await router.explain({ tokenIn, tokenOut, amountIn }, { timeoutMs: RHEA_TIMEOUT_MS });
        if ('quote' in answer) {
          return {
            amountOut: formatRawAmount(answer.quote.amountOut, buy.decimals),
            venue: 'rhea',
            observedAtMs: deps.now(),
          };
        }
        reason = answer.reason;
      }
      throw new Error(`${reason} Retried twice.`);
    },
  };
}

/** Reads a rule's swap from this network's venue: a dry quote, so a check can never create anything. */
function venueQuotes(deps: ExecutionDeps): QuoteSource {
  return {
    async read(request) {
      const venue = deps.venue;
      if (!venue) throw new Error('No quote venue is configured on this network.');
      const sell = deps.assets.byId(request.sellAssetId);
      const buy = deps.assets.byId(request.buyAssetId);
      if (!sell || !buy) throw new Error('This alert names an asset Harbor does not support.');
      const quote = await venue.quote({
        network: deps.config.network,
        sell,
        buy,
        amountIn: parseDecimalAmount(request.amount, sell.decimals, MAX_U128_RAW),
        slippageBps: 50,
      });
      return {
        amountOut: formatRawAmount(quote.amountOut, buy.decimals),
        venue: venue.id,
        observedAtMs: deps.now(),
      };
    },
  };
}

/**
 * One scheduler tick: queue a check for every active rule that is due, then run queued checks
 * under leases until the batch or time budget runs out. Overlapping ticks are safe: each due slot
 * becomes one job, and a job runs under exactly one lease at a time.
 */
export async function runAutomations(deps: AutomationDeps) {
  const db = drizzle(deps.db);
  const startedAtMs = deps.now();
  await failExhausted(db, startedAtMs);
  await pruneFinished(db, startedAtMs - FINISHED_JOB_KEEP_MS);

  const { results: due } = await deps.db
    .prepare(
      `SELECT id, revision, interval_ms, next_due_at_ms FROM automation_rules
       WHERE network = ? AND status = 'active' AND next_due_at_ms <= ?
       ORDER BY next_due_at_ms LIMIT ?`,
    )
    .bind(deps.network, startedAtMs + DUE_GRACE_MS, MAX_RULES_PER_TICK)
    .all<Pick<RuleRow, 'id' | 'revision' | 'interval_ms'> & { next_due_at_ms: number }>();
  for (const rule of due) {
    await enqueue(
      db,
      {
        kind: JOB_KIND,
        payload: {
          ruleId: rule.id,
          revision: rule.revision,
          scheduledForMs: rule.next_due_at_ms,
          enqueuedAtMs: startedAtMs,
        },
        dedupeKey: `automation:${rule.id}:${rule.revision}:${rule.next_due_at_ms}`,
        maxAttempts: MAX_ATTEMPTS,
      },
      startedAtMs,
    );
    // Missed slots are skipped rather than replayed: the next check is one interval from now.
    await deps.db
      .prepare(
        `UPDATE automation_rules SET next_due_at_ms = ?
         WHERE id = ? AND revision = ? AND status = 'active' AND next_due_at_ms = ?`,
      )
      .bind(startedAtMs + rule.interval_ms, rule.id, rule.revision, rule.next_due_at_ms)
      .run();
  }

  const owner = `scheduler:${crypto.randomUUID()}`;
  let evaluated = 0;
  let alerts = 0;
  while (evaluated < MAX_EVALUATIONS_PER_TICK && deps.now() - startedAtMs < TICK_BUDGET_MS) {
    const lease = await claim(db, { owner, leaseMs: LEASE_MS, nowMs: deps.now(), kinds: [JOB_KIND] });
    if (!lease) break;
    evaluated += 1;
    try {
      if (await runCheck(deps, lease)) alerts += 1;
    } catch (error) {
      if (error instanceof Superseded) continue;
      console.error(JSON.stringify({ automation: 'check_failed', job: lease.id, error: messageOf(error) }));
      await fail(db, lease, messageOf(error), deps.now(), RETRY_DELAY_MS).catch(() => {});
    }
  }
  return { scheduled: due.length, evaluated, alerts };
}

/**
 * Evaluates one due slot of one rule revision and records the result. Every write is fenced on the
 * job's lease, and the alert also on the rule still being active, armed and unchanged, so a retry
 * or an overlapping tick can never fire twice. Returns whether this slot fired an alert.
 */
async function runCheck(deps: AutomationDeps, lease: Lease): Promise<boolean> {
  const db = drizzle(deps.db);
  const payload = JobPayloadSchema.parse(lease.payload);
  const rule = await deps.db
    .prepare('SELECT * FROM automation_rules WHERE id = ? AND network = ?')
    .bind(payload.ruleId, deps.network)
    .first<RuleRow>();
  if (
    rule?.status !== 'active' ||
    rule.revision !== payload.revision ||
    (rule.next_due_at_ms !== null &&
      (payload.enqueuedAtMs ?? payload.scheduledForMs) < rule.next_due_at_ms - rule.interval_ms)
  ) {
    // Paused, revised, or superseded due slot: never replay old scans from a backlog.
    await complete(db, lease, deps.now());
    return false;
  }

  const evaluation = await evaluateMonitor(deps, rule.kind, JSON.parse(rule.config));
  const now = deps.now();
  const cooled = rule.last_triggered_at_ms === null || now - rule.last_triggered_at_ms >= rule.cooldown_ms;
  const fire = evaluation.result === 'true' && rule.armed === 1 && cooled;
  const triggerKey = `${rule.id}:${rule.revision}:${payload.scheduledForMs}`;
  const owned = `EXISTS (SELECT 1 FROM jobs WHERE id = ? AND status = 'running' AND attempts = ? AND lease_owner = ?)`;
  const ownedArgs = [lease.id, lease.attempt, lease.owner];

  const statements: D1PreparedStatement[] = fire
    ? [
        deps.db
          .prepare(
            `UPDATE automation_rules SET armed = 0, last_triggered_at_ms = ?, last_evaluated_at_ms = ?,
               last_result = 'true', updated_at_ms = ?,
               status = CASE WHEN mode = 'once' THEN 'completed' ELSE status END,
               next_due_at_ms = CASE WHEN mode = 'once' THEN NULL ELSE next_due_at_ms END
             WHERE id = ? AND revision = ? AND status = 'active' AND armed = 1
               AND (last_triggered_at_ms IS NULL OR ? - last_triggered_at_ms >= cooldown_ms) AND ${owned}`,
          )
          .bind(now, now, now, rule.id, rule.revision, now, ...ownedArgs),
        deps.db
          .prepare(
            `INSERT OR IGNORE INTO automation_triggers
               (id, rule_id, revision, trigger_key, evaluation_id, summary, created_at_ms)
             SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
          )
          .bind(crypto.randomUUID(), rule.id, rule.revision, triggerKey, lease.id, evaluation.reason, now),
      ]
    : [
        // A false result re-arms the rule; unknown leaves it as it was.
        deps.db
          .prepare(
            `UPDATE automation_rules SET armed = CASE WHEN ? = 'false' THEN 1 ELSE armed END,
               last_evaluated_at_ms = ?, last_result = ?, updated_at_ms = ?
             WHERE id = ? AND revision = ? AND status = 'active' AND ${owned}`,
          )
          .bind(evaluation.result, now, evaluation.result, now, rule.id, rule.revision, ...ownedArgs),
      ];
  statements.push(
    deps.db
      .prepare(
        `INSERT OR IGNORE INTO automation_evaluations
           (id, rule_id, revision, scheduled_for_ms, evaluated_at_ms, result, reason, evidence, triggered)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, EXISTS (SELECT 1 FROM automation_triggers WHERE trigger_key = ?)
         WHERE ${owned}`,
      )
      .bind(
        lease.id,
        rule.id,
        rule.revision,
        payload.scheduledForMs,
        now,
        evaluation.result,
        evaluation.reason,
        JSON.stringify(evaluation.evidence),
        triggerKey,
        ...ownedArgs,
      ),
  );
  await deps.db.batch(statements);

  // A retry of a slot that already fired re-sends the same alert message; the dedupe key absorbs it.
  const trigger = await deps.db
    .prepare('SELECT id, summary FROM automation_triggers WHERE trigger_key = ?')
    .bind(triggerKey)
    .first<{ id: string; summary: string }>();
  await complete(
    db,
    lease,
    deps.now(),
    trigger
      ? {
          topic: 'automation.alert',
          dedupeKey: `alert:${triggerKey}`,
          payload: { ruleId: rule.id, triggerId: trigger.id, network: rule.network, summary: trigger.summary },
        }
      : undefined,
  );
  return trigger !== null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'unknown error';
}
