import { env } from 'cloudflare:workers';

/** The cookie a browser signed in as `account` sends, backed by a session written straight to D1. */
export async function sessionCookie(account: string): Promise<string> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const user = `user:${account}`;
  const wallet = `wallet:${account}`;
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users (id, created_at_ms) VALUES (?, ?)').bind(user, now),
    env.DB.prepare(
      `INSERT OR IGNORE INTO wallet_accounts (id, user_id, network, account_id, verified_at_ms, created_at_ms)
       VALUES (?, ?, 'mainnet', ?, ?, ?)`,
    ).bind(wallet, user, account, now, now),
    env.DB.prepare(
      `INSERT INTO auth_sessions (id, user_id, wallet_account_id, network, created_at_ms, expires_at_ms)
       VALUES (?, ?, ?, 'mainnet', ?, ?)`,
    ).bind(await sha256Hex(token), user, wallet, now, now + 3_600_000),
  ]);
  return `harbor_session=${token}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
