import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app.ts';
import { requireSession } from '../auth/guard.ts';
import { executionDeps } from '../execution/store.ts';
import { createStrategy, dismissRun, listQueue, listStrategies, setStrategyStatus } from './strategies.ts';

const SYMBOL = z.string().regex(/^[A-Za-z0-9.$-]{1,16}$/);
const StrategySchema = z.strictObject({
  sell: SYMBOL,
  buy: SYMBOL,
  amount: z.string().min(1).max(64),
  everyHours: z
    .int()
    .min(1)
    .max(24 * 31),
});

/** The owner's strategies and the actions the agent queued for them. Everything is the owner's own. */
export function createAutopilotRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireSession);

  routes.get('/strategies', async (c) => c.json(await listStrategies(executionDeps(c.env), c.get('account'))));

  routes.post('/strategies', async (c) => {
    const body = StrategySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new AppError('INVALID_REQUEST', 'Send sell, buy, amount and everyHours.');
    return c.json(await createStrategy(executionDeps(c.env), c.get('account'), body.data), 201);
  });

  routes.post('/strategies/:id/:action{pause|resume}', async (c) =>
    c.json(
      await setStrategyStatus(
        executionDeps(c.env),
        c.get('account'),
        uuid(c.req.param('id')),
        c.req.param('action') === 'pause' ? 'paused' : 'active',
      ),
    ),
  );

  routes.delete('/strategies/:id', async (c) =>
    c.json(await setStrategyStatus(executionDeps(c.env), c.get('account'), uuid(c.req.param('id')), 'deleted')),
  );

  routes.get('/queue', async (c) => c.json(await listQueue(executionDeps(c.env), c.get('account'))));

  routes.post('/queue/:id/dismiss', async (c) =>
    c.json(await dismissRun(executionDeps(c.env), c.get('account'), uuid(c.req.param('id')))),
  );

  return routes;
}

function uuid(id: string): string {
  if (!z.uuid().safeParse(id).success) throw new AppError('NOT_FOUND', 'Not found.');
  return id;
}
