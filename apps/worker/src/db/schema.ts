import { NETWORKS } from '@harbor/domain/network';
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Mainnet and Testnet use separate databases; the network column still guards every row
// against a binding pointed at the wrong one. Times are Unix milliseconds.
const PROTOCOL_STATUSES = ['research', 'read', 'write'] as const;
const NETWORK_CHECK = sql.raw(`network IN (${NETWORKS.map((network) => `'${network}'`).join(', ')})`);

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  createdAtMs: integer('created_at_ms').notNull(),
});

export const walletAccounts = sqliteTable(
  'wallet_accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    network: text('network', { enum: NETWORKS }).notNull(),
    accountId: text('account_id').notNull(),
    verifiedAtMs: integer('verified_at_ms'),
    createdAtMs: integer('created_at_ms').notNull(),
  },
  (table) => [
    uniqueIndex('wallet_accounts_network_account_uq').on(table.network, table.accountId),
    index('wallet_accounts_user_idx').on(table.userId),
    check('wallet_accounts_network_ck', NETWORK_CHECK),
  ],
);

/** One-time sign-in challenges. A nonce is consumed once; the signed message is never submitted to the chain. */
export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    nonce: text('nonce').primaryKey(),
    network: text('network', { enum: NETWORKS }).notNull(),
    accountId: text('account_id').notNull(),
    browserSessionHash: text('browser_session_hash').notNull(),
    expiresAtMs: integer('expires_at_ms').notNull(),
    consumedAtMs: integer('consumed_at_ms'),
    createdAtMs: integer('created_at_ms').notNull(),
  },
  (table) => [
    index('auth_challenges_expiry_idx').on(table.expiresAtMs),
    check('auth_challenges_network_ck', NETWORK_CHECK),
  ],
);

/** Browser sessions after wallet verification. `id` is a hash of the cookie token; the token is never stored. */
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    walletAccountId: text('wallet_account_id')
      .notNull()
      .references(() => walletAccounts.id),
    network: text('network', { enum: NETWORKS }).notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
    expiresAtMs: integer('expires_at_ms').notNull(),
    revokedAtMs: integer('revoked_at_ms'),
  },
  (table) => [index('auth_sessions_user_idx').on(table.userId), check('auth_sessions_network_ck', NETWORK_CHECK)],
);

/** Approved protocols for this network. Writes stay off per protocol until its lifecycle is validated. */
export const protocolRegistry = sqliteTable(
  'protocol_registry',
  {
    id: text('id').primaryKey(),
    network: text('network', { enum: NETWORKS }).notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    status: text('status', { enum: PROTOCOL_STATUSES }).notNull().default('research'),
    writeEnabled: integer('write_enabled', { mode: 'boolean' }).notNull().default(false),
    version: integer('version').notNull().default(1),
    updatedAtMs: integer('updated_at_ms').notNull(),
  },
  (table) => [
    check('protocol_registry_network_ck', NETWORK_CHECK),
    check('protocol_registry_status_ck', sql`${table.status} IN ('research', 'read', 'write')`),
  ],
);

/** Verified asset identities. Amount fields elsewhere are decimal TEXT in these decimals. */
export const assetRegistry = sqliteTable(
  'asset_registry',
  {
    network: text('network', { enum: NETWORKS }).notNull(),
    canonicalId: text('canonical_id').notNull(),
    symbol: text('symbol').notNull(),
    chain: text('chain').notNull(),
    decimals: integer('decimals').notNull(),
    verifiedSource: text('verified_source').notNull(),
    verifiedAtMs: integer('verified_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.network, table.canonicalId] }),
    check('asset_registry_network_ck', NETWORK_CHECK),
    check('asset_registry_decimals_ck', sql`${table.decimals} BETWEEN 0 AND 38`),
  ],
);

export const INTENT_KINDS = ['swap'] as const;
export const INTENT_SOURCES = ['chat', 'form', 'autopilot'] as const;
export const PLAN_SOURCES = ['user', 'autopilot'] as const;
export const PLAN_STATUSES = [
  'policy_checked',
  'blocked',
  'awaiting_review',
  'awaiting_signature',
  'submitted',
  'confirming',
  'confirmed',
  // The provider refunded the deposit. A refund is never a success.
  'refunded',
  'failed',
  'expired',
  // The deposit may have executed but nothing proves how it ended; never treated as not executed.
  'outcome_unknown',
] as const;
const PLAN_STATUS_CHECK = sql.raw(`status IN (${PLAN_STATUSES.map((status) => `'${status}'`).join(', ')})`);

/** A validated request before any quote. Amounts are raw integers as TEXT in the asset's decimals. */
export const intents = sqliteTable(
  'intents',
  {
    id: text('id').primaryKey(),
    network: text('network', { enum: NETWORKS }).notNull(),
    kind: text('kind', { enum: INTENT_KINDS }).notNull(),
    sellAsset: text('sell_asset').notNull(),
    buyAsset: text('buy_asset').notNull(),
    sellAmountRaw: text('sell_amount_raw').notNull(),
    source: text('source', { enum: INTENT_SOURCES }).notNull(),
    // Where the bought asset should go, as asked. NULL means the signed-in account; the plan checks
    // whatever is asked against the owner's own addresses before anything can be approved.
    recipient: text('recipient'),
    createdAtMs: integer('created_at_ms').notNull(),
  },
  () => [check('intents_network_ck', NETWORK_CHECK)],
);

/** One provider answer for an intent. `providerQuote` is passed back unchanged to build the transaction. */
export const quotes = sqliteTable(
  'quotes',
  {
    id: text('id').primaryKey(),
    intentId: text('intent_id')
      .notNull()
      .references(() => intents.id),
    venue: text('venue').notNull(),
    slippageBps: integer('slippage_bps').notNull(),
    amountInRaw: text('amount_in_raw').notNull(),
    amountOutRaw: text('amount_out_raw').notNull(),
    minOutRaw: text('min_out_raw').notNull(),
    priceImpactBps: integer('price_impact_bps'),
    protocols: text('protocols').notNull(),
    providerQuote: text('provider_quote').notNull(),
    observedAtMs: integer('observed_at_ms').notNull(),
    expiresAtMs: integer('expires_at_ms').notNull(),
  },
  (table) => [index('quotes_intent_idx').on(table.intentId)],
);

/**
 * An immutable proposal for one account. Approval binds its digest; only an action matching exactly
 * that digest can move it forward. `tx_hash` is the user's signed deposit to `deposit_address`.
 * `one_click_status` is the provider's last word and is never settlement on its own: `confirmed`
 * also needs `delivery_verified_at_ms`, from checking the delivery independently of 1Click.
 */
export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    intentId: text('intent_id')
      .notNull()
      .references(() => intents.id),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id),
    network: text('network', { enum: NETWORKS }).notNull(),
    accountId: text('account_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status', { enum: PLAN_STATUSES }).notNull(),
    digest: text('digest').notNull(),
    // The plan's own checks: a block here stops the plan for everyone, owner included.
    policy: text('policy').notNull(),
    // The owner's signed policy applied to this plan: a block here means only the owner can approve it.
    policyCheck: text('policy_check'),
    policyId: text('policy_id'),
    source: text('source', { enum: PLAN_SOURCES }).notNull().default('user'),
    // Where delivery and any refund go, both checked against the owner's own addresses.
    recipient: text('recipient'),
    recipientChain: text('recipient_chain'),
    validUntilMs: integer('valid_until_ms'),
    approvedAtMs: integer('approved_at_ms'),
    quoteHash: text('quote_hash'),
    depositAddress: text('deposit_address'),
    // Empty when the quote has no memo, not NULL: SQLite's unique index treats NULLs as distinct, and a
    // deposit address must belong to one plan.
    depositMemo: text('deposit_memo').notNull().default(''),
    txHash: text('tx_hash'),
    oneClickStatus: text('one_click_status'),
    deliveryTxHash: text('delivery_tx_hash'),
    deliveryVerifiedAtMs: integer('delivery_verified_at_ms'),
    result: text('result'),
    errorCode: text('error_code'),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull(),
  },
  (table) => [
    uniqueIndex('plans_idempotency_uq').on(table.idempotencyKey),
    uniqueIndex('plans_network_tx_hash_uq').on(table.network, table.txHash),
    uniqueIndex('plans_network_deposit_uq').on(table.network, table.depositAddress, table.depositMemo),
    index('plans_account_idx').on(table.network, table.accountId),
    check('plans_network_ck', NETWORK_CHECK),
    check('plans_status_ck', PLAN_STATUS_CHECK),
  ],
);

/** Every plan state change, with who caused it and why. */
export const planEvents = sqliteTable(
  'plan_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actor: text('actor', { enum: ['user', 'system'] }).notNull(),
    reason: text('reason').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
  },
  (table) => [index('plan_events_plan_idx').on(table.planId)],
);

export const POLICY_STATUSES = ['pending', 'active', 'frozen', 'revoked', 'superseded'] as const;
const POLICY_STATUS_CHECK = sql.raw(`status IN (${POLICY_STATUSES.map((status) => `'${status}'`).join(', ')})`);

/**
 * A policy the owner signs with NEP-413: `body` is the canonical policy JSON, `message` the exact text
 * the wallet showed, which names `digest`. Only `pending` can be signed, once; freezing or revoking
 * never needs a signature, and only signing a new revision unfreezes.
 */
export const policies = sqliteTable(
  'policies',
  {
    id: text('id').primaryKey(),
    network: text('network', { enum: NETWORKS }).notNull(),
    ownerAccount: text('owner_account').notNull(),
    revision: integer('revision').notNull(),
    body: text('body').notNull(),
    digest: text('digest').notNull(),
    message: text('message').notNull(),
    nonce: text('nonce').notNull(),
    status: text('status', { enum: POLICY_STATUSES }).notNull(),
    publicKey: text('public_key'),
    signature: text('signature'),
    signedAtMs: integer('signed_at_ms'),
    frozenAtMs: integer('frozen_at_ms'),
    expiresAtMs: integer('expires_at_ms').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull(),
  },
  (table) => [
    uniqueIndex('policies_owner_revision_uq').on(table.network, table.ownerAccount, table.revision),
    uniqueIndex('policies_nonce_uq').on(table.nonce),
    index('policies_owner_status_idx').on(table.network, table.ownerAccount, table.status),
    check('policies_network_ck', NETWORK_CHECK),
    check('policies_status_ck', POLICY_STATUS_CHECK),
  ],
);

export const policyEvents = sqliteTable(
  'policy_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    policyId: text('policy_id')
      .notNull()
      .references(() => policies.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    actor: text('actor', { enum: ['user', 'system'] }).notNull(),
    reason: text('reason').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
  },
  (table) => [index('policy_events_policy_idx').on(table.policyId)],
);

export const AUTOMATION_KINDS = ['price_alert'] as const;
export const AUTOMATION_STATUSES = ['draft', 'active', 'paused', 'completed', 'deleted'] as const;
export const EVALUATION_RESULTS = ['true', 'false', 'unknown'] as const;
const AUTOMATION_STATUS_CHECK = sql.raw(`status IN (${AUTOMATION_STATUSES.map((status) => `'${status}'`).join(', ')})`);

/**
 * A monitoring rule. `config` is the accepted revision's typed condition; activation binds its
 * hash. `armed` is the hysteresis: a trigger disarms the rule until the condition is false again.
 */
export const automationRules = sqliteTable(
  'automation_rules',
  {
    id: text('id').primaryKey(),
    network: text('network', { enum: NETWORKS }).notNull(),
    kind: text('kind', { enum: AUTOMATION_KINDS }).notNull(),
    name: text('name').notNull(),
    ownerAccount: text('owner_account'),
    status: text('status', { enum: AUTOMATION_STATUSES }).notNull(),
    revision: integer('revision').notNull(),
    config: text('config').notNull(),
    configHash: text('config_hash').notNull(),
    mode: text('mode', { enum: ['once', 'repeat'] }).notNull(),
    intervalMs: integer('interval_ms').notNull(),
    cooldownMs: integer('cooldown_ms').notNull(),
    armed: integer('armed').notNull().default(1),
    nextDueAtMs: integer('next_due_at_ms'),
    lastEvaluatedAtMs: integer('last_evaluated_at_ms'),
    lastResult: text('last_result', { enum: EVALUATION_RESULTS }),
    lastTriggeredAtMs: integer('last_triggered_at_ms'),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull(),
  },
  (table) => [
    index('automation_rules_due_idx').on(table.network, table.status, table.nextDueAtMs),
    check('automation_rules_network_ck', NETWORK_CHECK),
    check('automation_rules_status_ck', AUTOMATION_STATUS_CHECK),
  ],
);

/** One evaluation of a rule revision, with the readings and derived values it used. */
export const automationEvaluations = sqliteTable(
  'automation_evaluations',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => automationRules.id),
    revision: integer('revision').notNull(),
    scheduledForMs: integer('scheduled_for_ms').notNull(),
    evaluatedAtMs: integer('evaluated_at_ms').notNull(),
    result: text('result', { enum: EVALUATION_RESULTS }).notNull(),
    reason: text('reason').notNull(),
    evidence: text('evidence').notNull(),
    triggered: integer('triggered').notNull().default(0),
  },
  (table) => [index('automation_evaluations_rule_idx').on(table.ruleId, table.evaluatedAtMs)],
);

/** A fired alert. The key makes a retried evaluation reuse its trigger instead of firing again. */
export const automationTriggers = sqliteTable(
  'automation_triggers',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => automationRules.id),
    revision: integer('revision').notNull(),
    triggerKey: text('trigger_key').notNull().unique(),
    evaluationId: text('evaluation_id').notNull(),
    summary: text('summary').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
    acknowledgedAtMs: integer('acknowledged_at_ms'),
  },
  (table) => [index('automation_triggers_rule_idx').on(table.ruleId, table.createdAtMs)],
);
