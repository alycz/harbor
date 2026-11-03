import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app.ts';
import { approvePlan, compareIntent, createPlan, listActivity, readIntent, readPlan } from './lifecycle.ts';
import { executionDeps } from './store.ts';
import { createSwapIntent } from './swap.ts';

const SYMBOL = z.string().regex(/^[A-Za-z0-9.$-]{1,16}$/);
const SwapIntentSchema = z.strictObject({
  kind: z.literal('swap'),
  sellAsset: SYMBOL,
  buyAsset: SYMBOL,
  sellAmount: z.string().min(1).max(64),
});
const PlanSchema = z.strictObject({ intentId: z.uuid(), quoteId: z.uuid(), accountId: z.string().min(2).max(64) });
const ApproveSchema = z.strictObject({ digest: z.string().regex(/^[0-9a-f]{64}$/) });
const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** Intent → quote → plan → approve. The agent can only create intents and quotes. */
export function createExecutionRoutes() {
  const routes = new Hono<AppEnv>();

  /** The assets this network can swap, for the swap form. */
  routes.get('/assets', (c) => {
    const deps = executionDeps(c.env);
    return c.json({ network: deps.config.network, assets: deps.assets.list() });
  });

  routes.post('/intents', async (c) => {
    const body = parse(
      SwapIntentSchema,
      await c.req.json().catch(() => null),
      'Send kind "swap" with sellAsset, buyAsset and sellAmount.',
    );
    const intent = await createSwapIntent(executionDeps(c.env), {
      sell: body.sellAsset,
      buy: body.buyAsset,
      amount: body.sellAmount,
      source: 'form',
    });
    return c.json(intent, 201);
  });

  routes.get('/intents/:id', async (c) => c.json(await readIntent(executionDeps(c.env), uuid(c.req.param('id')))));

  routes.post('/intents/:id/compare', async (c) =>
    c.json(await compareIntent(executionDeps(c.env), uuid(c.req.param('id')))),
  );

  routes.post('/plans', async (c) => {
    const key = IdempotencyKeySchema.safeParse(c.req.header('idempotency-key'));
    if (!key.success) throw new AppError('INVALID_REQUEST', 'Send an Idempotency-Key header (8 to 128 characters).');
    const body = parse(PlanSchema, await c.req.json().catch(() => null), 'Send intentId, quoteId and accountId.');
    const plan = await createPlan(executionDeps(c.env), { ...body, idempotencyKey: key.data });
    return c.json(plan, 201);
  });

  /** The account's plans that reached the network, newest first. Read-only. */
  routes.get('/plans', async (c) => c.json(await listActivity(executionDeps(c.env), c.req.query('account') ?? '')));

  routes.get('/plans/:id', async (c) => c.json(await readPlan(executionDeps(c.env), uuid(c.req.param('id')))));

  routes.post('/plans/:id/approve', async (c) => {
    const body = parse(ApproveSchema, await c.req.json().catch(() => null), 'Send the reviewed digest.');
    return c.json(await approvePlan(executionDeps(c.env), uuid(c.req.param('id')), body));
  });

  return routes;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('INVALID_REQUEST', message);
  return parsed.data;
}

function uuid(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new AppError('NOT_FOUND', 'Not found.');
  return id;
}
