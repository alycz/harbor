import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { createStrategy, listQueue, runAutopilot } from '../src/autopilot/strategies.ts';
import { assetRegistry } from '../src/execution/assets.ts';
import { compareIntent, createPlan } from '../src/execution/lifecycle.ts';
import type { ExecutionDeps } from '../src/execution/store.ts';
import { fakeWorld } from './execution-fakes.ts';
import { sessionCookie } from './session.ts';

const HOUR = 60 * 60_000;

function deps(): { deps: ExecutionDeps; clock: { now: number } } {
  const clock = { now: Date.now() };
  const fakes = fakeWorld(clock, 3_600_000n);
  return {
    clock,
    deps: {
      db: env.DB,
      config: {
        network: 'mainnet',
        executionEnabled: true,
        writeAdapters: new Set(['oneclick']),
        oneClickJwt: null,
        rpcUrl: 'https://rpc.test',
      },
      venue: {
        id: 'oneclick',
        quote: async (request) => ({
          amountIn: request.amountIn,
          amountOut: 3_600_000n,
          minAmountOut: 3_582_000n,
          priceImpactBps: null,
          platform: 'NEAR Intents',
          protocols: ['NEAR Intents'],
          raw: {},
        }),
      },
      executor: fakes.executor,
      chain: fakes.chain,
      evm: fakes.evm,
      assets: assetRegistry('mainnet'),
      now: () => clock.now,
    },
  };
}

async function policyFor(owner: string, now: number, status = 'active') {
  await env.DB.prepare(
    `INSERT INTO policies (id, network, owner_account, revision, body, digest, message, nonce, status, signed_at_ms,
       expires_at_ms, created_at_ms, updated_at_ms)
     VALUES (?, 'mainnet', ?, 1, ?, 'd', 'm', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      owner,
      JSON.stringify({
        version: 'harbor.policy.v1',
        network: 'mainnet',
        owner,
        allowedAssets: ['nep141:wrap.near', 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'],
        spend: [
          {
            assetId: 'nep141:wrap.near',
            perActionMaxRaw: '2000000000000000000000000',
            dailyMaxRaw: '2000000000000000000000000',
            totalMaxRaw: '5000000000000000000000000',
          },
        ],
        destinations: [],
        slippageMaxBps: 50,
        quoteMaxAgeSeconds: 600,
        schedule: { kind: 'interval', everySeconds: 3_600 },
        validFrom: new Date(now - HOUR).toISOString(),
        expiresAt: new Date(now + 24 * HOUR).toISOString(),
      }),
      crypto.randomUUID(),
      status,
      now,
      now + 24 * HOUR,
      now,
      now,
    )
    .run();
}

describe('autopilot', () => {
  it('queues a due action only under an active policy, once per interval, and the plan stays in policy', async () => {
    const h = deps();
    const owner = 'dca.near';
    await policyFor(owner, h.clock.now);
    await createStrategy(h.deps, owner, { sell: 'NEAR', buy: 'USDC', amount: '1', everyHours: 1 });

    await Promise.all([runAutopilot(h.deps), runAutopilot(h.deps)]);
    let { queue } = await listQueue(h.deps, owner);
    expect(queue).toHaveLength(1);
    expect(queue[0]?.intent).toMatchObject({ source: 'autopilot', sell: { symbol: 'NEAR', amount: '1' } });

    // Not due again until the interval has passed.
    await runAutopilot(h.deps);
    expect((await listQueue(h.deps, owner)).queue).toHaveLength(1);

    const intentId = queue[0]?.intent.id ?? '';
    const [quote] = (await compareIntent(h.deps, intentId)).quotes;
    const plan = await createPlan(h.deps, {
      intentId,
      quoteId: quote?.id ?? '',
      accountId: owner,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(plan).toMatchObject({ source: 'autopilot', status: 'awaiting_review' });
    expect(plan.policyCheck?.verdict).not.toBe('block');

    h.clock.now += HOUR + 1;
    await runAutopilot(h.deps);
    ({ queue } = await listQueue(h.deps, owner));
    expect(queue).toHaveLength(2);
  });

  it('skips, and queues nothing, without an active policy', async () => {
    const h = deps();
    await createStrategy(h.deps, 'nopolicy-dca.near', { sell: 'NEAR', buy: 'USDC', amount: '1', everyHours: 1 });
    await policyFor('frozen-dca.near', h.clock.now, 'frozen');
    await createStrategy(h.deps, 'frozen-dca.near', { sell: 'NEAR', buy: 'USDC', amount: '1', everyHours: 1 });
    const summary = await runAutopilot(h.deps);
    expect(summary.skipped).toBeGreaterThanOrEqual(2);
    expect((await listQueue(h.deps, 'nopolicy-dca.near')).queue).toHaveLength(0);
    expect((await listQueue(h.deps, 'frozen-dca.near')).queue).toHaveLength(0);
  });

  it('only lets an owner see and change their own strategies over HTTP', async () => {
    const request = (path: string, cookie: string, init: { method?: string; body?: unknown } = {}) =>
      createApp().request(
        `https://harbor.test/api/autopilot${path}`,
        {
          method: init.method ?? 'GET',
          headers: { 'content-type': 'application/json', cookie },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        },
        env,
      );
    expect((await request('/strategies', '')).status).toBe(401);
    const alice = await sessionCookie('alice-dca.near');
    const created = await request('/strategies', alice, {
      method: 'POST',
      body: { sell: 'NEAR', buy: 'USDC', amount: '0.5', everyHours: 24 },
    });
    expect(created.status).toBe(201);
    const { strategies } = await created.json<{ strategies: { id: string; status: string }[] }>();
    const id = strategies[0]?.id ?? '';
    const bob = await sessionCookie('bob-dca.near');
    expect((await request(`/strategies/${id}/pause`, bob, { method: 'POST', body: {} })).status).toBe(404);
    expect((await (await request('/strategies', bob)).json<{ strategies: unknown[] }>()).strategies).toHaveLength(0);
    const paused = await request(`/strategies/${id}/pause`, alice, { method: 'POST', body: {} });
    expect((await paused.json<{ strategies: { status: string }[] }>()).strategies[0]?.status).toBe('paused');
    expect(
      (
        await request('/strategies', alice, {
          method: 'POST',
          body: { sell: 'USDC.arb', buy: 'NEAR', amount: '1', everyHours: 1 },
        })
      ).status,
    ).toBe(400);
  });
});
