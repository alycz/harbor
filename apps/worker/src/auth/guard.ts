import { AppError } from '@harbor/domain/errors';
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
