import { isNearAccountId, isOnNetwork } from '@harbor/domain/account';
import { AppError } from '@harbor/domain/errors';
import { NEAR_NETWORK_INFO } from '@harbor/domain/near';
import type { Network } from '@harbor/domain/network';
import {
  AccessKeyLookupFailed,
  type AccessKeyReader,
  createAccessKeyReader,
  SignInRejected,
  verifySignIn,
} from '@harbor/near/sign-in';

import { decodeExecutionConfig } from '../config.ts';

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const RANDOM_BYTES = 32;

export interface AuthDeps {
  db: D1Database;
  network: Network;
  accessKeys: AccessKeyReader;
  now(): number;
}

export interface Session {
  accountId: string;
  network: Network;
  expiresAt: string;
}

export function authDeps(env: Env): AuthDeps {
  const config = decodeExecutionConfig(env);
  return {
    db: env.DB,
    network: config.network,
    accessKeys: createAccessKeyReader(config.rpcUrl),
    now: Date.now,
  };
}

/** What the wallet shows the user. It says plainly that signing moves nothing. */
function signInMessage(accountId: string, network: Network): string {
  return `Sign in to Harbor as ${accountId} on NEAR ${network}.\n\nThis proves you own the account. It cannot move funds.`;
}

/**
 * Starts a sign-in. The nonce is single-use and tied to this browser through a token only it holds,
 * so a signature captured elsewhere cannot complete it.
 */
export async function issueChallenge(deps: AuthDeps, accountId: string) {
  assertAccount(deps, accountId);
  const nonce = randomBase64();
  const browserToken = randomBase64();
  const now = deps.now();
  const expiresAtMs = now + CHALLENGE_TTL_MS;
  await deps.db.batch([
    deps.db.prepare('DELETE FROM auth_challenges WHERE expires_at_ms <= ?').bind(now),
    deps.db
      .prepare(
        `INSERT INTO auth_challenges (nonce, network, account_id, browser_session_hash, expires_at_ms, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(nonce, deps.network, accountId, await sha256Hex(browserToken), expiresAtMs, now),
  ]);
  return { nonce, browserToken, message: signInMessage(accountId, deps.network), expiresAtMs };
}

/**
 * Finishes a sign-in and opens a session. The nonce is consumed before anything else is checked, so
 * one challenge gets one attempt, whether it succeeds or not.
 */
export async function completeSignIn(
  deps: AuthDeps,
  input: {
    accountId: string;
    publicKey: string;
    signature: string;
    nonce: string;
    recipient: string;
    browserToken: string | undefined;
  },
) {
  assertAccount(deps, input.accountId);
  const consumed = await consumeChallenge(deps, input);
  if (!consumed) throw new AppError('UNAUTHORIZED', 'This sign-in expired or was already used. Please try again.');

  try {
    await verifySignIn(
      {
        accountId: input.accountId,
        publicKey: input.publicKey,
        signature: input.signature,
        message: signInMessage(input.accountId, deps.network),
        recipient: input.recipient,
        nonce: Uint8Array.from(atob(input.nonce), (character) => character.charCodeAt(0)),
      },
      deps.accessKeys,
    );
  } catch (error) {
    if (error instanceof SignInRejected) throw new AppError('UNAUTHORIZED', rejectionMessage(error));
    if (error instanceof AccessKeyLookupFailed) {
      throw new AppError('UNAVAILABLE', 'The account could not be checked on NEAR right now. Please try again.');
    }
    throw error;
  }
  return openSession(deps, input.accountId);
}

/** The live session for a cookie's token, or null. Only the token's hash is ever stored. */
export async function readSession(deps: AuthDeps, token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const row = await deps.db
    .prepare(
      `SELECT wallet_accounts.account_id AS account_id, auth_sessions.expires_at_ms AS expires_at_ms
       FROM auth_sessions JOIN wallet_accounts ON wallet_accounts.id = auth_sessions.wallet_account_id
       WHERE auth_sessions.id = ? AND auth_sessions.network = ? AND auth_sessions.revoked_at_ms IS NULL
         AND auth_sessions.expires_at_ms > ?`,
    )
    .bind(await sha256Hex(token), deps.network, deps.now())
    .first<{ account_id: string; expires_at_ms: number }>();
  if (!row) return null;
  return { accountId: row.account_id, network: deps.network, expiresAt: new Date(row.expires_at_ms).toISOString() };
}

export async function endSession(deps: AuthDeps, token: string | undefined): Promise<void> {
  if (!token) return;
  await deps.db
    .prepare('UPDATE auth_sessions SET revoked_at_ms = ? WHERE id = ? AND revoked_at_ms IS NULL')
    .bind(deps.now(), await sha256Hex(token))
    .run();
}

function assertAccount(deps: AuthDeps, accountId: string) {
  if (!isNearAccountId(accountId)) throw new AppError('INVALID_REQUEST', 'Send a valid NEAR account ID.');
  if (!isOnNetwork(accountId, deps.network)) {
    throw new AppError('INVALID_REQUEST', `That account is not on NEAR ${NEAR_NETWORK_INFO[deps.network].chainId}.`);
  }
}

async function consumeChallenge(
  deps: AuthDeps,
  input: { accountId: string; nonce: string; browserToken?: string | undefined },
) {
  if (!input.browserToken) return false;
  const now = deps.now();
  const result = await deps.db
    .prepare(
      `UPDATE auth_challenges SET consumed_at_ms = ?
       WHERE nonce = ? AND network = ? AND account_id = ? AND browser_session_hash = ?
         AND consumed_at_ms IS NULL AND expires_at_ms > ?`,
    )
    .bind(now, input.nonce, deps.network, input.accountId, await sha256Hex(input.browserToken), now)
    .run();
  return result.meta.changes === 1;
}

/** One user per verified wallet account. IDs derive from the account, so a repeat or racing sign-in reuses them. */
async function openSession(deps: AuthDeps, accountId: string) {
  const now = deps.now();
  const walletId = await sha256Hex(`wallet:${deps.network}:${accountId}`);
  const userId = await sha256Hex(`user:${deps.network}:${accountId}`);
  const token = randomBase64();
  const expiresAtMs = now + SESSION_TTL_MS;
  await deps.db.batch([
    deps.db.prepare('INSERT OR IGNORE INTO users (id, created_at_ms) VALUES (?, ?)').bind(userId, now),
    deps.db
      .prepare(
        `INSERT INTO wallet_accounts (id, user_id, network, account_id, verified_at_ms, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET verified_at_ms = excluded.verified_at_ms`,
      )
      .bind(walletId, userId, deps.network, accountId, now, now),
    deps.db
      .prepare(
        `INSERT INTO auth_sessions (id, user_id, wallet_account_id, network, created_at_ms, expires_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(await sha256Hex(token), userId, walletId, deps.network, now, expiresAtMs),
  ]);
  const session: Session = { accountId, network: deps.network, expiresAt: new Date(expiresAtMs).toISOString() };
  return { token, session, expiresAtMs };
}

function rejectionMessage(error: SignInRejected): string {
  switch (error.reason) {
    case 'NOT_FULL_ACCESS':
      return 'That key can only call contracts. Sign in with a full-access key on this account.';
    case 'UNKNOWN_KEY':
      return 'That key does not belong to this account on NEAR.';
    default:
      return 'The wallet signature could not be verified.';
  }
}

function randomBase64(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(RANDOM_BYTES))));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
