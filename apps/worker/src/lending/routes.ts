import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import type { AppEnv } from '../app.ts';
import { requireSession } from '../auth/guard.ts';
import { approvePlan, cancelPlan, createPlan, lendingDeps, readAccount, readPlan, submitPlan } from './lifecycle.ts';

const PlanRequest = z.strictObject({
  asset: z.string().min(1).max(320),
  amount: z.string().min(1).max(64),
});
const Approval = z.strictObject({ digest: z.string().regex(/^[0-9a-f]{64}$/) });
const Submission = z.strictObject({ txHash: z.string().min(1).max(64) });
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
const PlanId = z.uuid();

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('INVALID_REQUEST', message);
  return parsed.data;
}

/**
 * Rhea Lend supplies from the owner's NEAR wallet. Everything here needs the owner's session, and only
 * that owner can read or move their deposits. Live rates are public at /api/markets/live.
 */
export function createLendingRoutes() {
  const routes = new Hono<AppEnv>();

  /** The owner's own data and deposits: a session, and never cached. */
  const owner = createMiddleware<AppEnv>(async (c, next) => {
    await requireSession(c, async () => {
      await next();
      c.header('cache-control', 'no-store');
    });
  });

  routes.get('/rhea/account', owner, async (c) => {
    const asset = parse(z.string().min(1).max(320), c.req.query('asset'), 'Name the token, such as USDC.');
    return c.json(await readAccount(lendingDeps(c.env), c.get('account'), asset));
  });
  routes.post('/rhea/plans', owner, async (c) => {
    const key = parse(IdempotencyKey, c.req.header('idempotency-key'), 'Send an Idempotency-Key header.');
    const body = parse(PlanRequest, await c.req.json().catch(() => null), 'Send the token and an amount.');
    return c.json(await createPlan(lendingDeps(c.env), c.get('account'), body, key), 201);
  });
  routes.get('/rhea/plans/:id', owner, async (c) => {
    const id = parse(PlanId, c.req.param('id'), 'No such deposit.');
    return c.json(await readPlan(lendingDeps(c.env), c.get('account'), id));
  });
  routes.post('/rhea/plans/:id/approve', owner, async (c) => {
    const id = parse(PlanId, c.req.param('id'), 'No such deposit.');
    const body = parse(Approval, await c.req.json().catch(() => null), 'Send the digest you reviewed.');
    return c.json(await approvePlan(lendingDeps(c.env), c.get('account'), id, body));
  });
  routes.post('/rhea/plans/:id/submit', owner, async (c) => {
    const id = parse(PlanId, c.req.param('id'), 'No such deposit.');
    const body = parse(Submission, await c.req.json().catch(() => null), 'Send the transaction hash.');
    return c.json(await submitPlan(lendingDeps(c.env), c.get('account'), id, body.txHash));
  });
  routes.post('/rhea/plans/:id/cancel', owner, async (c) => {
    const id = parse(PlanId, c.req.param('id'), 'No such deposit.');
    return c.json(await cancelPlan(lendingDeps(c.env), c.get('account'), id));
  });

  return routes;
}
