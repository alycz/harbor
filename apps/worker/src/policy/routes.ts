import { AppError } from '@harbor/domain/errors';
import { createAccessKeyReader } from '@harbor/near/sign-in';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app.ts';
import { recipientOf, requireSession } from '../auth/guard.ts';
import { decodeExecutionConfig } from '../config.ts';
import { assetRegistry } from '../execution/assets.ts';
import {
  currentPolicy,
  draftPolicy,
  freezePolicy,
  type PolicyDeps,
  PolicyDraftSchema,
  revokePolicy,
  signPolicy,
} from './policies.ts';

const SignSchema = z.strictObject({
  publicKey: z.string().min(1).max(128),
  signature: z.string().min(1).max(256),
});

export function policyDeps(env: Env): PolicyDeps {
  const config = decodeExecutionConfig(env);
  return {
    db: env.DB,
    network: config.network,
    assets: assetRegistry(config.network),
    accessKeys: createAccessKeyReader(config.rpcUrl),
    now: Date.now,
  };
}

/**
 * The owner's signed policy: draft → sign in the wallet → active; freeze or revoke at any time. Every
 * route acts only on the signed-in account's own policy.
 */
export function createPolicyRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireSession);

  routes.get('/current', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await currentPolicy(policyDeps(c.env), c.get('account')));
  });

  routes.post('/', async (c) => {
    const body = PolicyDraftSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      throw new AppError('INVALID_REQUEST', body.error.issues[0]?.message ?? 'Send a complete policy draft.');
    }
    const drafted = await draftPolicy(policyDeps(c.env), c.get('account'), body.data);
    return c.json({ ...drafted, recipient: recipientOf(c) }, 201);
  });

  routes.post('/:id/sign', async (c) => {
    const id = c.req.param('id');
    if (!z.uuid().safeParse(id).success) throw new AppError('NOT_FOUND', 'No such policy.');
    const body = SignSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new AppError('INVALID_REQUEST', 'Send publicKey and signature.');
    return c.json(
      await signPolicy(policyDeps(c.env), c.get('account'), id, { ...body.data, recipient: recipientOf(c) }),
    );
  });

  routes.post('/current/freeze', async (c) => c.json(await freezePolicy(policyDeps(c.env), c.get('account'))));
  routes.post('/current/revoke', async (c) => c.json(await revokePolicy(policyDeps(c.env), c.get('account'))));

  return routes;
}
