import { AppError } from '@harbor/domain/errors';
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import type { AppEnv } from '../app.ts';
import { SESSION_COOKIE } from './guard.ts';
import { authDeps, completeSignIn, endSession, issueChallenge, readSession } from './session.ts';

const CHALLENGE_COOKIE = 'harbor_sign_in';
const AUTH_PATH = '/api/auth';
const ACCOUNT = z.string().min(2).max(64);

const ChallengeSchema = z.strictObject({ accountId: ACCOUNT });
const VerifySchema = z.strictObject({
  accountId: ACCOUNT,
  publicKey: z.string().min(1).max(128),
  signature: z.string().min(1).max(256),
  nonce: z.base64().length(44),
});

/**
 * Wallet sign-in over NEP-413: challenge → the user signs in their wallet → verify. Signing a
 * message cannot move funds, and no key or seed phrase ever reaches this Worker.
 */
export function createAuthRoutes() {
  const routes = new Hono<AppEnv>();

  routes.post('/challenge', async (c) => {
    const body = ChallengeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new AppError('INVALID_REQUEST', 'Send accountId.');
    const challenge = await issueChallenge(authDeps(c.env), body.data.accountId);
    setCookie(c, CHALLENGE_COOKIE, challenge.browserToken, {
      ...cookieOptions(c, AUTH_PATH),
      expires: new Date(challenge.expiresAtMs),
    });
    return c.json(
      {
        nonce: challenge.nonce,
        message: challenge.message,
        recipient: recipientOf(c),
        expiresAt: new Date(challenge.expiresAtMs).toISOString(),
      },
      201,
    );
  });

  routes.post('/verify', async (c) => {
    const body = VerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new AppError('INVALID_REQUEST', 'Send accountId, publicKey, signature and nonce.');
    const opened = await completeSignIn(authDeps(c.env), {
      ...body.data,
      recipient: recipientOf(c),
      browserToken: getCookie(c, CHALLENGE_COOKIE),
    });
    deleteCookie(c, CHALLENGE_COOKIE, cookieOptions(c, AUTH_PATH));
    setCookie(c, SESSION_COOKIE, opened.token, { ...cookieOptions(c, '/'), expires: new Date(opened.expiresAtMs) });
    return c.json({ session: opened.session });
  });

  routes.get('/session', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ session: await readSession(authDeps(c.env), getCookie(c, SESSION_COOKIE)) });
  });

  routes.post('/logout', async (c) => {
    await endSession(authDeps(c.env), getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c, '/'));
    return c.json({ ok: true });
  });

  return routes;
}

/** The signature names who it is for. Using this host means one signed for another site never verifies here. */
function recipientOf(c: Context<AppEnv>): string {
  return new URL(c.req.url).host;
}

function cookieOptions(c: Context<AppEnv>, path: string) {
  return {
    path,
    httpOnly: true,
    sameSite: 'Lax',
    // Plain http only happens on localhost in development.
    secure: new URL(c.req.url).protocol === 'https:',
  } as const;
}
