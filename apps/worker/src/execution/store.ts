import type { SwapVenue } from '@harbor/adapters/venue';
import { formatRawAmount, rawFromText } from '@harbor/domain/amount';
import type { AssetRef } from '@harbor/domain/asset';
import { AppError } from '@harbor/domain/errors';
import type { Network } from '@harbor/domain/network';
import type { Decision } from '@harbor/policy/engine';

import { decodeExecutionConfig, type ExecutionConfig } from '../config.ts';
import type { INTENT_KINDS, PLAN_STATUSES } from '../db/schema.ts';
import { type AssetRegistry, assetRegistry } from './assets.ts';

export type PlanStatus = (typeof PLAN_STATUSES)[number];
type IntentKind = (typeof INTENT_KINDS)[number];

export interface ExecutionDeps {
  db: D1Database;
  config: ExecutionConfig;
  /** Where swaps are quoted on this network, or null when none is configured. */
  venue: SwapVenue | null;
  /** The assets this network can swap, resolved from a verified registry, never from a ticker alone. */
  assets: AssetRegistry;
  now(): number;
}

export function executionDeps(env: Env): ExecutionDeps {
  const config = decodeExecutionConfig(env);
  return {
    db: env.DB,
    config,
    venue: null,
    assets: assetRegistry(config.network),
    now: Date.now,
  };
}

export interface IntentRow {
  id: string;
  network: Network;
  kind: IntentKind;
  /** The canonical ID of the asset sold. */
  sell_asset: string;
  /** The canonical ID of the asset bought. */
  buy_asset: string;
  sell_amount_raw: string;
  source: 'chat' | 'form';
  created_at_ms: number;
}

export interface QuoteRow {
  id: string;
  intent_id: string;
  venue: string;
  slippage_bps: number;
  amount_in_raw: string;
  amount_out_raw: string;
  min_out_raw: string;
  price_impact_bps: number | null;
  protocols: string;
  provider_quote: string;
  observed_at_ms: number;
  expires_at_ms: number;
}

export interface PlanRow {
  id: string;
  intent_id: string;
  quote_id: string;
  network: Network;
  account_id: string;
  idempotency_key: string;
  status: PlanStatus;
  digest: string;
  policy: string;
  valid_until_ms: number | null;
  approved_at_ms: number | null;
  tx_hash: string | null;
  result: string | null;
  error_code: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

/** Columns a transition may set besides status. */
const PATCHABLE = ['valid_until_ms', 'approved_at_ms', 'tx_hash', 'result', 'error_code'] as const;
export type Patch = Partial<Record<(typeof PATCHABLE)[number], string | number | null>>;

export async function insertIntent(deps: ExecutionDeps, row: IntentRow): Promise<void> {
  await deps.db
    .prepare(
      `INSERT INTO intents (id, network, kind, sell_asset, buy_asset, sell_amount_raw, source, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.network,
      row.kind,
      row.sell_asset,
      row.buy_asset,
      row.sell_amount_raw,
      row.source,
      row.created_at_ms,
    )
    .run();
}

export async function insertQuote(deps: ExecutionDeps, row: QuoteRow): Promise<void> {
  await deps.db
    .prepare(
      `INSERT INTO quotes (id, intent_id, venue, slippage_bps, amount_in_raw, amount_out_raw, min_out_raw,
         price_impact_bps, protocols, provider_quote, observed_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.intent_id,
      row.venue,
      row.slippage_bps,
      row.amount_in_raw,
      row.amount_out_raw,
      row.min_out_raw,
      row.price_impact_bps,
      row.protocols,
      row.provider_quote,
      row.observed_at_ms,
      row.expires_at_ms,
    )
    .run();
}

/** The existing plan for an idempotency key, refusing reuse of the key for a different plan. */
export async function existingPlan(
  deps: ExecutionDeps,
  input: { intentId: string; quoteId: string; accountId: string; idempotencyKey: string },
): Promise<PlanRow | null> {
  const existing = await deps.db
    .prepare('SELECT * FROM plans WHERE idempotency_key = ?')
    .bind(input.idempotencyKey)
    .first<PlanRow>();
  if (!existing) return null;
  if (
    existing.intent_id !== input.intentId ||
    existing.quote_id !== input.quoteId ||
    existing.account_id !== input.accountId
  ) {
    throw new AppError('CONFLICT', 'This idempotency key was already used for a different plan.');
  }
  return existing;
}

export async function insertPlan(deps: ExecutionDeps, row: PlanRow): Promise<void> {
  await deps.db.batch([
    deps.db
      .prepare(
        `INSERT INTO plans (id, intent_id, quote_id, network, account_id, idempotency_key, status, digest, policy,
           error_code, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.id,
        row.intent_id,
        row.quote_id,
        row.network,
        row.account_id,
        row.idempotency_key,
        row.status,
        row.digest,
        row.policy,
        row.error_code,
        row.created_at_ms,
        row.updated_at_ms,
      ),
    deps.db
      .prepare(
        'INSERT INTO plan_events (plan_id, from_status, to_status, actor, reason, created_at_ms) VALUES (?, NULL, ?, ?, ?, ?)',
      )
      .bind(row.id, row.status, 'user', 'Plan created from a quote', row.created_at_ms),
  ]);
}

/** A new plan row with nothing approved yet. */
export function newPlanRow(input: {
  intent: IntentRow;
  quoteId: string;
  accountId: string;
  idempotencyKey: string;
  status: PlanStatus;
  digest: string;
  policy: string;
  errorCode: string | null;
  now: number;
}): PlanRow {
  return {
    id: crypto.randomUUID(),
    intent_id: input.intent.id,
    quote_id: input.quoteId,
    network: input.intent.network,
    account_id: input.accountId,
    idempotency_key: input.idempotencyKey,
    status: input.status,
    digest: input.digest,
    policy: input.policy,
    valid_until_ms: null,
    approved_at_ms: null,
    tx_hash: null,
    result: null,
    error_code: input.errorCode,
    created_at_ms: input.now,
    updated_at_ms: input.now,
  };
}

/**
 * Moves a plan from its current status to `to`, recording the event in the same batch. Returns
 * false when another request changed the plan first; nothing is written then.
 */
export async function transition(
  deps: ExecutionDeps,
  plan: PlanRow,
  to: PlanStatus,
  patch: Patch,
  actor: 'user' | 'system',
  reason: string,
) {
  const columns = Object.keys(patch).filter((key): key is (typeof PATCHABLE)[number] =>
    (PATCHABLE as readonly string[]).includes(key),
  );
  const now = deps.now();
  const update = deps.db
    .prepare(
      `UPDATE plans SET status = ?, updated_at_ms = ?${columns.map((column) => `, ${column} = ?`).join('')}
       WHERE id = ? AND status = ?`,
    )
    .bind(to, now, ...columns.map((column) => patch[column] ?? null), plan.id, plan.status);
  const event = deps.db
    .prepare(
      `INSERT INTO plan_events (plan_id, from_status, to_status, actor, reason, created_at_ms)
       SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    )
    .bind(plan.id, plan.status, to, actor, reason.slice(0, 500), now);
  const [result] = await deps.db.batch([update, event]);
  return result?.meta.changes === 1;
}

export async function transitionOrReload(
  deps: ExecutionDeps,
  plan: PlanRow,
  to: PlanStatus,
  patch: Patch,
  actor: 'user' | 'system',
  reason: string,
) {
  await transition(deps, plan, to, patch, actor, reason);
  return loadPlan(deps, plan.id);
}

export async function loadIntent(deps: ExecutionDeps, id: string): Promise<IntentRow> {
  const row = await deps.db
    .prepare('SELECT * FROM intents WHERE id = ? AND network = ?')
    .bind(id, deps.config.network)
    .first<IntentRow>();
  if (!row) throw new AppError('NOT_FOUND', 'No such request.');
  return row;
}

export async function loadQuote(deps: ExecutionDeps, id: string): Promise<QuoteRow> {
  const row = await deps.db.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<QuoteRow>();
  if (!row) throw new AppError('NOT_FOUND', 'No such quote.');
  return row;
}

export async function loadPlan(deps: ExecutionDeps, id: string): Promise<PlanRow> {
  const row = await deps.db
    .prepare('SELECT * FROM plans WHERE id = ? AND network = ?')
    .bind(id, deps.config.network)
    .first<PlanRow>();
  if (!row) throw new AppError('NOT_FOUND', 'No such plan.');
  return row;
}

/** A raw amount with its asset, formatted in that asset's decimals. */
export function rawAmount(asset: AssetRef, raw: string) {
  return {
    symbol: asset.symbol,
    canonicalId: asset.canonicalId,
    amount: formatRawAmount(rawFromText(raw), asset.decimals),
    raw,
  };
}

export function canonicalJson(value: Record<string, string | number>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function logFailure(step: string, error: unknown): void {
  console.error(
    JSON.stringify({
      execution: step,
      error: error instanceof Error ? error.name : 'unknown',
      detail: error instanceof Error ? error.message.slice(0, 300) : undefined,
    }),
  );
}

/** Fields every plan view shares, whatever the action. */
export function basePlanView(row: PlanRow) {
  return {
    id: row.id,
    status: row.status,
    network: row.network,
    account: row.account_id,
    digest: row.digest,
    policy: JSON.parse(row.policy) as Decision,
    validUntil: row.valid_until_ms === null ? null : new Date(row.valid_until_ms).toISOString(),
    approvedAt: row.approved_at_ms === null ? null : new Date(row.approved_at_ms).toISOString(),
    txHash: row.tx_hash,
    errorCode: row.error_code,
  };
}

export function firstBlock(decision: Decision): string | null {
  return decision.verdict === 'block' ? (decision.reasons.find((reason) => !reason.pass)?.code ?? null) : null;
}
