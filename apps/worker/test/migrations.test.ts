import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const FOUNDATION_TABLES = [
  'asset_registry',
  'auth_challenges',
  'auth_sessions',
  'jobs',
  'outbox',
  'protocol_registry',
  'users',
  'wallet_accounts',
];

describe('migrations', () => {
  it('let a plan record its deposit, provider status and delivery check', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(plans)').all<{ name: string }>();
    expect(results.map((column) => column.name)).toEqual(
      expect.arrayContaining(['tx_hash', 'deposit_address', 'one_click_status', 'delivery_verified_at_ms']),
    );
  });

  it('accept the statuses a deposit can end in and refuse unknown ones', async () => {
    const now = Date.now();
    const id = crypto.randomUUID();
    const plan = (planId: string, status: string) =>
      env.DB.prepare(
        `INSERT INTO plans (id, intent_id, quote_id, network, account_id, idempotency_key, status, digest, policy,
           created_at_ms, updated_at_ms) VALUES (?, ?, ?, 'mainnet', 'alice.near', ?, ?, 'd', '{}', ?, ?)`,
      ).bind(planId, id, id, planId, status, now, now);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO intents (id, network, kind, sell_asset, buy_asset, sell_amount_raw, source, created_at_ms)
         VALUES (?, 'mainnet', 'swap', 'a', 'b', '1', 'form', ?)`,
      ).bind(id, now),
      env.DB.prepare(
        `INSERT INTO quotes (id, intent_id, venue, slippage_bps, amount_in_raw, amount_out_raw, min_out_raw, protocols,
           provider_quote, observed_at_ms, expires_at_ms) VALUES (?, ?, 'oneclick', 50, '1', '1', '1', '[]', '{}', ?, ?)`,
      ).bind(id, id, now, now),
      plan(crypto.randomUUID(), 'refunded'),
      plan(crypto.randomUUID(), 'outcome_unknown'),
    ]);
    await expect(plan(crypto.randomUUID(), 'settled').run()).rejects.toThrow(/CHECK/);

    // One deposit address cannot back two plans, with or without a memo; plans with none yet don't collide.
    const deposit = (planId: string, address: string | null) =>
      env.DB.prepare('UPDATE plans SET deposit_address = ? WHERE id = ?').bind(address, planId);
    const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
    await env.DB.batch([plan(first, 'awaiting_signature'), plan(second, 'awaiting_signature')]);
    await deposit(first, 'deposit.near').run();
    await expect(deposit(second, 'deposit.near').run()).rejects.toThrow(/UNIQUE/);
    await deposit(second, 'other.near').run();
  });

  it('create every foundation table in D1', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual(expect.arrayContaining(FOUNDATION_TABLES));
  });

  it('enforce one wallet account per network and address', async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, created_at_ms) VALUES (?, ?)').bind('u1', now),
      env.DB.prepare(
        'INSERT INTO wallet_accounts (id, user_id, network, account_id, created_at_ms) VALUES (?, ?, ?, ?, ?)',
      ).bind('w1', 'u1', 'testnet', 'alice.testnet', now),
    ]);
    await expect(
      env.DB.prepare(
        'INSERT INTO wallet_accounts (id, user_id, network, account_id, created_at_ms) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('w2', 'u1', 'testnet', 'alice.testnet', now)
        .run(),
    ).rejects.toThrow(/UNIQUE/);
  });
});
