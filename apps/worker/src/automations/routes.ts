import { AppError } from '@harbor/domain/errors';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app.ts';
import { requireSession } from '../auth/guard.ts';
import { automationDeps } from './dispatch.ts';
import { evaluatePriceAlert } from './evaluate.ts';
import {
  type AutomationDeps,
  acknowledgeTrigger,
  activateRule,
  createRule,
  deleteRule,
  listRules,
  loadOwnRule,
  parseConfig,
  pauseRule,
  type RuleRow,
  readRule,
  reviseRule,
} from './rules.ts';

const CreateSchema = z.strictObject({
  kind: z.literal('price_alert'),
  name: z.string().max(80).optional(),
  config: z.unknown(),
});
const ReviseSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  name: z.string().max(80).optional(),
  config: z.unknown(),
});
const ActivateSchema = z.strictObject({
  revision: z.number().int().positive(),
  configHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const PreviewSchema = z.strictObject({ config: z.unknown() });

/**
 * Monitoring rules: draft → activate the exact revision → scheduled checks → alerts. Each rule
 * belongs to the signed-in account that made it, and only that account can see or change it.
 * Checks only read quotes; nothing here can sign, submit or move funds.
 */
export function createAutomationRoutes() {
  const routes = new Hono<AppEnv>();

  /** Evaluates settings now without saving anything or firing an alert. */
  routes.post('/preview', async (c) => {
    const body = parse(PreviewSchema, await c.req.json().catch(() => null), 'Send the monitor config.');
    const deps = automationDeps(c.env);
    return c.json({
      evaluatedAt: new Date(deps.now()).toISOString(),
      ...(await evaluatePriceAlert(parseConfig(body.config), deps.quotes)),
    });
  });

  routes.get('/', requireSession, async (c) =>
    c.json({ automations: await listRules(automationDeps(c.env), c.get('account')) }),
  );

  routes.post('/', requireSession, async (c) => {
    const body = parse(CreateSchema, await c.req.json().catch(() => null), 'Send kind "price_alert" and config.');
    return c.json(await createRule(automationDeps(c.env), { ...body, account: c.get('account') }), 201);
  });

  routes.post('/alerts/:id/acknowledge', requireSession, async (c) => {
    await acknowledgeTrigger(automationDeps(c.env), uuid(c.req.param('id')), c.get('account'));
    return c.json({ ok: true });
  });

  routes.get('/:id', requireSession, async (c) => {
    const { deps, id } = await owned(c);
    return c.json(await readRule(deps, id));
  });

  routes.post('/:id/revisions', requireSession, async (c) => {
    const { deps, id } = await owned(c);
    const body = parse(ReviseSchema, await c.req.json().catch(() => null), 'Send expectedRevision and config.');
    return c.json(await reviseRule(deps, id, body));
  });

  routes.post('/:id/activate', requireSession, async (c) => {
    const { deps, id } = await owned(c);
    const body = parse(
      ActivateSchema,
      await c.req.json().catch(() => null),
      'Send the reviewed revision and configHash.',
    );
    return c.json(await activateRule(deps, id, body));
  });

  routes.post('/:id/pause', requireSession, async (c) => {
    const { deps, id } = await owned(c);
    return c.json(await pauseRule(deps, id));
  });

  /** A bounded check of the saved rule, with no record and no alert. */
  routes.post('/:id/test', requireSession, async (c) => {
    const { deps, rule } = await owned(c);
    return c.json({
      evaluatedAt: new Date(deps.now()).toISOString(),
      ...(await evaluatePriceAlert(parseConfig(JSON.parse(rule.config)), deps.quotes)),
    });
  });

  routes.delete('/:id', requireSession, async (c) => {
    const { deps, id } = await owned(c);
    await deleteRule(deps, id);
    return c.json({ ok: true });
  });

  return routes;
}

/** The rule named in the path, if it belongs to the signed-in account; otherwise not found. */
async function owned(c: Context<AppEnv>): Promise<{ deps: AutomationDeps; id: string; rule: RuleRow }> {
  const deps = automationDeps(c.env);
  const id = uuid(c.req.param('id') ?? '');
  return { deps, id, rule: await loadOwnRule(deps, id, c.get('account')) };
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
