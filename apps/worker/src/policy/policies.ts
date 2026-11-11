import { isNearAccountId } from '@harbor/domain/account';
import { AmountError, formatRawAmount, MAX_U128_RAW, parseDecimalAmount, rawToText } from '@harbor/domain/amount';
import type { AssetRef } from '@harbor/domain/asset';
import { AppError } from '@harbor/domain/errors';
import type { Network } from '@harbor/domain/network';
import { AccessKeyLookupFailed, type AccessKeyReader, SignInRejected, verifySignIn } from '@harbor/near/sign-in';
import { dayWindowStart, type SignedPolicy } from '@harbor/policy/check';
import {
  canonicalPolicyJson,
  type Destination,
  POLICY_VERSION,
  type Policy,
  PolicySchema,
  policyDigest,
  policyMessage,
} from '@harbor/policy/policy';
import { z } from 'zod';

import type { POLICY_STATUSES } from '../db/schema.ts';
import type { AssetRegistry } from '../execution/assets.ts';

const DRAFT_TTL_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const NONCE_BYTES = 32;
/** Plan states whose input amount counts against a spend limit. An unknown outcome counts as spent. */
const COMMITTED = ['awaiting_signature', 'submitted', 'confirming', 'confirmed', 'outcome_unknown'] as const;

/** What each chain's own addresses look like. A destination on any other chain cannot be signed. */
const ADDRESS_FORMATS: Readonly<Record<string, (address: string) => boolean>> = {
  near: isNearAccountId,
  eth: (address) => /^0x[0-9a-fA-F]{40}$/.test(address),
  base: (address) => /^0x[0-9a-fA-F]{40}$/.test(address),
  arb: (address) => /^0x[0-9a-fA-F]{40}$/.test(address),
  sol: (address) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address),
};

type PolicyStatus = (typeof POLICY_STATUSES)[number];

export interface PolicyDeps {
  db: D1Database;
  network: Network;
  assets: AssetRegistry;
  accessKeys: AccessKeyReader;
  now(): number;
}

interface PolicyRow {
  id: string;
  network: Network;
  owner_account: string;
  revision: number;
  body: string;
  digest: string;
  message: string;
  nonce: string;
  status: PolicyStatus;
  public_key: string | null;
  signature: string | null;
  signed_at_ms: number | null;
  frozen_at_ms: number | null;
  expires_at_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
}

const DECIMAL = z.string().regex(/^(0|[1-9]\d{0,30})(\.\d{1,24})?$/, 'Enter a plain decimal amount.');
const SYMBOL = z.string().regex(/^[A-Za-z0-9.$-]{1,16}$/);

/** What the policy editor sends: symbols and decimal amounts, which the server resolves and converts. */
export const PolicyDraftSchema = z.strictObject({
  assets: z.array(SYMBOL).max(32),
  spend: z
    .array(z.strictObject({ asset: SYMBOL, perAction: DECIMAL, perDay: DECIMAL, total: DECIMAL }))
    .min(1)
    .max(16),
  destinations: z.array(z.strictObject({ chain: z.string().max(32), address: z.string().min(2).max(128) })).max(16),
  slippageMaxBps: z.int().min(1).max(500),
  quoteMaxAgeSeconds: z.int().min(10).max(600),
  agentEveryHours: z
    .int()
    .min(1)
    .max(24 * 31)
    .nullable(),
  expiresInDays: z.int().min(1).max(90),
});
export type PolicyDraft = z.infer<typeof PolicyDraftSchema>;

/**
 * Turns the editor's draft into a policy and holds it for the owner's signature. Nothing applies
 * until the wallet signs the exact message returned here.
 */
export async function draftPolicy(deps: PolicyDeps, owner: string, draft: PolicyDraft) {
  const now = deps.now();
  const policy = buildPolicy(deps, owner, draft, now);
  const digest = await policyDigest(policy);
  const latest = await deps.db
    .prepare('SELECT MAX(revision) AS revision FROM policies WHERE network = ? AND owner_account = ?')
    .bind(deps.network, owner)
    .first<{ revision: number | null }>();
  const revision = (latest?.revision ?? 0) + 1;
  const message = policyMessage(policy, digest, revision, (assetId) => describe(deps, assetId));
  const row: PolicyRow = {
    id: crypto.randomUUID(),
    network: deps.network,
    owner_account: owner,
    revision,
    body: canonicalPolicyJson(policy),
    digest,
    message,
    nonce: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(NONCE_BYTES)))),
    status: 'pending',
    public_key: null,
    signature: null,
    signed_at_ms: null,
    frozen_at_ms: null,
    expires_at_ms: Date.parse(policy.expiresAt),
    created_at_ms: now,
    updated_at_ms: now,
  };
  await deps.db.batch([
    deps.db
      .prepare(
        "DELETE FROM policy_events WHERE policy_id IN (SELECT id FROM policies WHERE status = 'pending' AND network = ? AND owner_account = ? AND created_at_ms <= ?)",
      )
      .bind(deps.network, owner, now - DRAFT_TTL_MS),
    deps.db
      .prepare(
        "DELETE FROM policies WHERE status = 'pending' AND network = ? AND owner_account = ? AND created_at_ms <= ?",
      )
      .bind(deps.network, owner, now - DRAFT_TTL_MS),
    deps.db
      .prepare(
        `INSERT INTO policies (id, network, owner_account, revision, body, digest, message, nonce, status, expires_at_ms,
           created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.id,
        row.network,
        row.owner_account,
        row.revision,
        row.body,
        row.digest,
        row.message,
        row.nonce,
        row.status,
        row.expires_at_ms,
        row.created_at_ms,
        row.updated_at_ms,
      ),
    eventStatement(deps, row.id, null, 'pending', 'user', 'Drafted for signing', now),
  ]);
  return { ...policyView(deps, row), message, nonce: row.nonce };
}

/**
 * Activates a drafted policy once the owner's wallet signed its exact message with a full-access key.
 * The previous policy, active or frozen, is superseded in the same write.
 */
export async function signPolicy(
  deps: PolicyDeps,
  owner: string,
  id: string,
  input: { publicKey: string; signature: string; recipient: string },
) {
  const row = await loadOwn(deps, id, owner);
  if (row.status !== 'pending') throw new AppError('CONFLICT', 'This policy is not waiting for a signature.');
  const now = deps.now();
  if (now - row.created_at_ms > DRAFT_TTL_MS) {
    throw new AppError('CONFLICT', 'This draft expired. Review the policy and sign again.');
  }
  try {
    await verifySignIn(
      {
        accountId: owner,
        publicKey: input.publicKey,
        signature: input.signature,
        message: row.message,
        recipient: input.recipient,
        nonce: Uint8Array.from(atob(row.nonce), (character) => character.charCodeAt(0)),
      },
      deps.accessKeys,
    );
  } catch (error) {
    if (error instanceof SignInRejected) {
      throw new AppError(
        'UNAUTHORIZED',
        error.reason === 'NOT_FULL_ACCESS'
          ? 'That key can only call contracts. Sign with a full-access key on this account.'
          : 'The wallet signature could not be verified.',
      );
    }
    if (error instanceof AccessKeyLookupFailed) {
      throw new AppError('UNAVAILABLE', 'The account could not be checked on NEAR right now. Please try again.');
    }
    throw error;
  }
  const previous = await deps.db
    .prepare(
      "SELECT * FROM policies WHERE network = ? AND owner_account = ? AND status IN ('active', 'frozen') AND id != ?",
    )
    .bind(deps.network, owner, id)
    .all<PolicyRow>();
  const [activated] = await deps.db.batch([
    deps.db
      .prepare(
        `UPDATE policies SET status = 'active', public_key = ?, signature = ?, signed_at_ms = ?, updated_at_ms = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(input.publicKey, input.signature, now, now, id),
    eventStatement(deps, id, 'pending', 'active', 'user', 'Signed in the wallet', now),
    ...previous.results.flatMap((old) => [
      deps.db
        .prepare("UPDATE policies SET status = 'superseded', updated_at_ms = ? WHERE id = ? AND status = ?")
        .bind(now, old.id, old.status),
      eventStatement(deps, old.id, old.status, 'superseded', 'user', `Replaced by revision ${row.revision}`, now),
    ]),
  ]);
  if (activated?.meta.changes !== 1) throw new AppError('CONFLICT', 'This policy is not waiting for a signature.');
  return currentPolicy(deps, owner);
}

/** Stops the agent at once. No signature is needed to narrow what it may do; only signing again undoes it. */
export async function freezePolicy(deps: PolicyDeps, owner: string) {
  return setStatus(deps, owner, ['active'], 'frozen', 'Frozen by the owner');
}

/** Ends the policy for good. The agent can do nothing on its own until a new one is signed. */
export async function revokePolicy(deps: PolicyDeps, owner: string) {
  return setStatus(deps, owner, ['active', 'frozen'], 'revoked', 'Revoked by the owner');
}

/** The owner's signed policy, frozen or not, with what has been committed against each limit. */
export async function currentPolicy(deps: PolicyDeps, owner: string) {
  const row = await latestSigned(deps.db, deps.network, owner);
  if (!row) return { policy: null };
  const body = JSON.parse(row.body) as Policy;
  const now = deps.now();
  const usage = await Promise.all(
    body.spend.map(async (limit) => {
      const spent = await spentOf(deps.db, deps.network, owner, limit.assetId, row.signed_at_ms ?? now, now);
      const asset = describe(deps, limit.assetId);
      return {
        asset: asset.symbol,
        perAction: asset.format(limit.perActionMaxRaw),
        perDay: asset.format(limit.dailyMaxRaw),
        total: asset.format(limit.totalMaxRaw),
        spentLastDay: asset.format(rawToText(spent.lastDay)),
        spentTotal: asset.format(rawToText(spent.sinceSigned)),
      };
    }),
  );
  return { policy: { ...policyView(deps, row), usage } };
}

/** The latest policy the owner signed and has not revoked, as the policy check reads it. */
export async function loadSignedPolicy(db: D1Database, network: Network, owner: string): Promise<SignedPolicy | null> {
  const row = await latestSigned(db, network, owner);
  if (!row || (row.status !== 'active' && row.status !== 'frozen')) return null;
  return {
    id: row.id,
    body: PolicySchema.parse(JSON.parse(row.body)),
    status: row.status,
    signedAtMs: row.signed_at_ms ?? row.created_at_ms,
  };
}

/** Raw amounts of one asset the owner committed: in the last 24 hours, and since `sinceMs`. */
export async function spentOf(
  db: D1Database,
  network: Network,
  owner: string,
  assetId: string,
  sinceMs: number,
  nowMs: number,
) {
  const { results } = await db
    .prepare(
      `SELECT quotes.amount_in_raw AS amount, plans.approved_at_ms AS approved_at_ms
       FROM plans JOIN intents ON intents.id = plans.intent_id JOIN quotes ON quotes.id = plans.quote_id
       WHERE plans.network = ? AND plans.account_id = ? AND intents.sell_asset = ?
         AND plans.approved_at_ms IS NOT NULL AND plans.approved_at_ms >= ?
         AND plans.status IN (${COMMITTED.map(() => '?').join(', ')})`,
    )
    .bind(network, owner, assetId, Math.min(sinceMs, dayWindowStart(nowMs)), ...COMMITTED)
    .all<{ amount: string; approved_at_ms: number }>();
  let lastDay = 0n;
  let sinceSigned = 0n;
  for (const row of results) {
    const amount = BigInt(row.amount);
    if (row.approved_at_ms >= nowMs - DAY_MS) lastDay += amount;
    if (row.approved_at_ms >= sinceMs) sinceSigned += amount;
  }
  return { lastDay, sinceSigned };
}

export function addressIsValid(chain: string, address: string): boolean {
  return ADDRESS_FORMATS[chain]?.(address) ?? false;
}

function buildPolicy(deps: PolicyDeps, owner: string, draft: PolicyDraft, now: number): Policy {
  const resolve = (symbol: string): AssetRef => {
    const asset = deps.assets.bySymbol(symbol);
    if (!asset) throw new AppError('INVALID_REQUEST', `${symbol} is not a supported asset on this network.`);
    return asset;
  };
  const toRaw = (asset: AssetRef, amount: string, label: string) => {
    try {
      return rawToText(parseDecimalAmount(amount, asset.decimals, MAX_U128_RAW));
    } catch (error) {
      throw new AppError(
        'INVALID_REQUEST',
        `${label} for ${asset.symbol}: ${error instanceof AmountError ? error.message : 'enter a valid amount.'}`,
      );
    }
  };
  const spend = draft.spend.map((limit) => {
    const asset = resolve(limit.asset);
    return {
      assetId: asset.canonicalId,
      perActionMaxRaw: toRaw(asset, limit.perAction, 'Per-action limit'),
      dailyMaxRaw: toRaw(asset, limit.perDay, 'Daily limit'),
      totalMaxRaw: toRaw(asset, limit.total, 'Total budget'),
    };
  });
  const allowed = [
    ...new Set([...draft.assets.map((symbol) => resolve(symbol).canonicalId), ...spend.map((limit) => limit.assetId)]),
  ];
  const destinations: Destination[] = [];
  for (const destination of draft.destinations) {
    const chain = destination.chain.trim();
    const address = destination.address.trim();
    if (!addressIsValid(chain, address)) {
      throw new AppError('INVALID_REQUEST', `${address.slice(0, 64)} is not a valid ${chain} address.`);
    }
    if (chain === 'near' && address === owner) continue;
    if (!destinations.some((entry) => entry.chain === chain && entry.address === address)) {
      destinations.push({ chain, address });
    }
  }
  const parsed = PolicySchema.safeParse({
    version: POLICY_VERSION,
    network: deps.network,
    owner,
    allowedAssets: allowed,
    spend,
    destinations,
    slippageMaxBps: draft.slippageMaxBps,
    quoteMaxAgeSeconds: draft.quoteMaxAgeSeconds,
    schedule:
      draft.agentEveryHours === null
        ? { kind: 'once' }
        : { kind: 'interval', everySeconds: draft.agentEveryHours * 3_600 },
    validFrom: new Date(now).toISOString(),
    expiresAt: new Date(now + draft.expiresInDays * DAY_MS).toISOString(),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError('INVALID_REQUEST', `The policy is not valid: ${issue?.message ?? 'check the limits'}.`);
  }
  return parsed.data;
}

async function setStatus(
  deps: PolicyDeps,
  owner: string,
  from: readonly PolicyStatus[],
  to: PolicyStatus,
  reason: string,
) {
  const row = await latestSigned(deps.db, deps.network, owner);
  if (!row || !from.includes(row.status)) {
    throw new AppError(
      'CONFLICT',
      to === 'frozen' ? 'There is no active policy to freeze.' : 'There is no policy to revoke.',
    );
  }
  const now = deps.now();
  const [updated] = await deps.db.batch([
    deps.db
      .prepare(
        `UPDATE policies SET status = ?, updated_at_ms = ?${to === 'frozen' ? ', frozen_at_ms = ?' : ''} WHERE id = ? AND status = ?`,
      )
      .bind(...(to === 'frozen' ? [to, now, now] : [to, now]), row.id, row.status),
    eventStatement(deps, row.id, row.status, to, 'user', reason, now),
  ]);
  if (updated?.meta.changes !== 1) throw new AppError('CONFLICT', 'The policy changed. Reload and try again.');
  return currentPolicy(deps, owner);
}

async function latestSigned(db: D1Database, network: Network, owner: string): Promise<PolicyRow | null> {
  return db
    .prepare(
      `SELECT * FROM policies WHERE network = ? AND owner_account = ? AND status IN ('active', 'frozen', 'revoked')
       ORDER BY revision DESC LIMIT 1`,
    )
    .bind(network, owner)
    .first<PolicyRow>();
}

async function loadOwn(deps: PolicyDeps, id: string, owner: string): Promise<PolicyRow> {
  const row = await deps.db
    .prepare('SELECT * FROM policies WHERE id = ? AND network = ? AND owner_account = ?')
    .bind(id, deps.network, owner)
    .first<PolicyRow>();
  if (!row) throw new AppError('NOT_FOUND', 'No such policy.');
  return row;
}

function eventStatement(
  deps: PolicyDeps,
  policyId: string,
  from: PolicyStatus | null,
  to: PolicyStatus,
  actor: 'user' | 'system',
  reason: string,
  now: number,
) {
  return deps.db
    .prepare(
      'INSERT INTO policy_events (policy_id, from_status, to_status, actor, reason, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(policyId, from, to, actor, reason, now);
}

function describe(deps: PolicyDeps, assetId: string) {
  const asset = deps.assets.byId(assetId);
  return {
    symbol: asset?.symbol ?? assetId,
    format: (raw: string) => (asset ? formatRawAmount(BigInt(raw), asset.decimals) : raw),
  };
}

function policyView(deps: PolicyDeps, row: PolicyRow) {
  const body = PolicySchema.parse(JSON.parse(row.body));
  return {
    id: row.id,
    revision: row.revision,
    status: row.status,
    digest: row.digest,
    owner: row.owner_account,
    signedAt: row.signed_at_ms === null ? null : new Date(row.signed_at_ms).toISOString(),
    frozenAt: row.frozen_at_ms === null ? null : new Date(row.frozen_at_ms).toISOString(),
    validFrom: body.validFrom,
    expiresAt: body.expiresAt,
    assets: body.allowedAssets.map((assetId) => describe(deps, assetId).symbol),
    destinations: body.destinations,
    slippageMaxBps: body.slippageMaxBps,
    quoteMaxAgeSeconds: body.quoteMaxAgeSeconds,
    agentEveryHours: body.schedule.kind === 'interval' ? body.schedule.everySeconds / 3_600 : null,
    spend: body.spend.map((limit) => {
      const asset = describe(deps, limit.assetId);
      return {
        asset: asset.symbol,
        perAction: asset.format(limit.perActionMaxRaw),
        perDay: asset.format(limit.dailyMaxRaw),
        total: asset.format(limit.totalMaxRaw),
      };
    }),
  };
}
