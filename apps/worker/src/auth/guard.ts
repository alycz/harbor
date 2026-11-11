import { AppError } from '@harbor/domain/errors';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../app.ts';
import { authDeps, readSession } from './session.ts';

export const SESSION_COOKIE = 'harbor_session';

/** Lets a request through only with a live wallet session, and records whose account it is. */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await readSession(authDeps(c.env), getCookie(c, SESSION_COOKIE));
  if (!session) throw new AppError('UNAUTHORIZED', 'Connect your wallet to continue.');
  c.set('account', session.accountId);
  await next();
});

/** Who a NEP-413 signature is for. Using this host means one signed for another site never verifies here. */
export function recipientOf(c: Context<AppEnv>): string {
  return new URL(c.req.url).host;
}
