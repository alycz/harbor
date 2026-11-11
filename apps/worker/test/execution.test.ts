import { env, exports } from 'cloudflare:workers';
import { VenueRefusal } from '@harbor/adapters/venue';
import type { AssetRef } from '@harbor/domain/asset';
import { describe, expect, it } from 'vitest';

import type { ExecutionConfig } from '../src/config.ts';
import { assetRegistry } from '../src/execution/assets.ts';
import { approvePlan, compareIntent, createPlan, listActivity, readPlan } from '../src/execution/lifecycle.ts';
import { recoverPendingPlans } from '../src/execution/recovery.ts';
import type { ExecutionDeps } from '../src/execution/store.ts';
import { createSwapIntent } from '../src/execution/swap.ts';
import { fakeWorld } from './execution-fakes.ts';
import { sessionCookie } from './session.ts';

const ORIGIN = 'https://harbor.test';
const START_MS = 1_800_000_000_000;
const ACCOUNT = 'alice.near';
const ASSETS: AssetRef[] = [
  {
    network: 'mainnet',
    canonicalId: 'nep141:usdc.example.near',
    symbol: 'USDC',
    name: 'USD Coin',
    chain: 'near',
    decimals: 6,
  },
  { network: 'mainnet', canonicalId: 'nep141:wrap.near', symbol: 'NEAR', name: 'NEAR', chain: 'near', decimals: 24 },
];
const AMOUNT_OUT = 26_000_000_000_000_000_000_000_000n; // 26 NEAR
const MIN_OUT = 25_870_000_000_000_000_000_000_000n;

interface Fixture {
  deps: ExecutionDeps;
  clock: { now: number };
  venue: { refuse: boolean; minOut: bigint };
}

function createFixture(overrides: Partial<ExecutionConfig> = {}): Fixture {
  const clock = { now: START_MS };
  const venue = { refuse: false, minOut: MIN_OUT };
  const config: ExecutionConfig = {
    network: 'mainnet',
    executionEnabled: true,
    writeAdapters: new Set(['oneclick']),
    oneClickJwt: null,
    rpcUrl: 'https://rpc.test',
    ...overrides,
  };
  const fakes = fakeWorld(clock, AMOUNT_OUT);
  fakes.world.minOut = MIN_OUT;
  const deps: ExecutionDeps = {
    db: env.DB,
    config,
    executor: config.executionEnabled && config.writeAdapters.has('oneclick') ? fakes.executor : null,
    chain: fakes.chain,
    evm: fakes.evm,
    venue: {
      id: 'oneclick',
      quote: async (request) => {
        if (venue.refuse) throw new VenueRefusal('NO_ROUTE', 'No route for this pair right now.');
        return {
          amountIn: request.amountIn,
          amountOut: AMOUNT_OUT,
          minAmountOut: venue.minOut,
          priceImpactBps: 12,
          platform: '1click',
          protocols: ['near-intents'],
          raw: { originAsset: request.sell.canonicalId, amount: request.amountIn },
        };
      },
    },
    assets: assetRegistry('mainnet', ASSETS),
    now: () => clock.now,
  };
  return { deps, clock, venue };
}

async function quotedPlan(h: Fixture, accountId = ACCOUNT) {
  const intent = await createSwapIntent(h.deps, { sell: 'USDC', buy: 'NEAR', amount: '100', source: 'chat' });
  const [quote] = (await compareIntent(h.deps, intent.id)).quotes;
  if (!quote) throw new Error('no quote');
  const plan = await createPlan(h.deps, {
    intentId: intent.id,
    quoteId: quote.id,
    accountId,
    idempotencyKey: crypto.randomUUID(),
  });
  return { intent, quote, plan };
}

async function eventsOf(planId: string) {
  const { results } = await env.DB.prepare(
    'SELECT from_status, to_status, actor FROM plan_events WHERE plan_id = ? ORDER BY id',
  )
    .bind(planId)
    .all<{ from_status: string | null; to_status: string; actor: string }>();
  return results.map((row) => `${row.from_status ?? '∅'}→${row.to_status}:${row.actor}`);
}

describe('swap intents', () => {
  it('stores the exact raw amount in the asset decimals and refuses unusable input', async () => {
    const { deps } = createFixture();
    const intent = await createSwapIntent(deps, { sell: 'USDC', buy: 'NEAR', amount: '100.5', source: 'form' });
    expect(intent.sell).toMatchObject({ symbol: 'USDC', amount: '100.5', raw: '100500000' });
    expect(intent.buy.canonicalId).toBe('nep141:wrap.near');

    for (const amount of ['0', '-1', '1e3', '1.0000001', 'abc']) {
      await expect(createSwapIntent(deps, { sell: 'USDC', buy: 'NEAR', amount, source: 'form' })).rejects.toThrow();
    }
    await expect(createSwapIntent(deps, { sell: 'NEAR', buy: 'NEAR', amount: '1', source: 'form' })).rejects.toThrow(
      'two different assets',
    );
    await expect(createSwapIntent(deps, { sell: 'DOGE', buy: 'NEAR', amount: '1', source: 'form' })).rejects.toThrow(
      'not a supported asset',
    );
  });
});

describe('quotes', () => {
  it('records the venue quote with an expiry and formats it in each asset', async () => {
    const h = createFixture();
    const intent = await createSwapIntent(h.deps, { sell: 'USDC', buy: 'NEAR', amount: '100', source: 'form' });
    const { quotes } = await compareIntent(h.deps, intent.id);
    expect(quotes[0]).toMatchObject({
      venue: 'oneclick',
      expectedOut: { symbol: 'NEAR', amount: '26' },
      minimumOut: { symbol: 'NEAR', amount: '25.87' },
      harborFeeBps: 0,
    });
  });

  it('reports a venue refusal and a missing venue as unavailable', async () => {
    const h = createFixture();
    const intent = await createSwapIntent(h.deps, { sell: 'USDC', buy: 'NEAR', amount: '1', source: 'form' });
    h.venue.refuse = true;
    await expect(compareIntent(h.deps, intent.id)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(compareIntent({ ...h.deps, venue: null }, intent.id)).rejects.toThrow('No swap venue');
  });
});

describe('plans', () => {
  it('runs the policy, binds a digest, and moves to review with every event recorded', async () => {
    const h = createFixture();
    const { plan } = await quotedPlan(h);
    expect(plan).toMatchObject({ status: 'awaiting_review', account: ACCOUNT, errorCode: null });
    expect(plan.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.policy.verdict).not.toBe('block');
    expect(plan.depositAddress).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.recipient).toEqual({ chain: 'near', address: ACCOUNT });

    const approved = await approvePlan(h.deps, plan.id, ACCOUNT, { digest: plan.digest });
    expect(approved).toMatchObject({ status: 'awaiting_signature' });
    expect(approved.validUntil).not.toBeNull();
    expect(await eventsOf(plan.id)).toEqual(['∅→awaiting_review:user', 'awaiting_review→awaiting_signature:user']);
  });

  it('blocks a quote whose minimum is above its output', async () => {
    const h = createFixture();
    h.venue.minOut = AMOUNT_OUT + 1n;
    const { plan } = await quotedPlan(h);
    expect(plan).toMatchObject({ status: 'blocked', errorCode: 'MIN_OUTPUT_INVALID' });
    await expect(approvePlan(h.deps, plan.id, ACCOUNT, { digest: plan.digest })).rejects.toThrow(
      'not waiting for review',
    );
  });

  it('reuses a plan for a repeated idempotency key and refuses the key for another plan', async () => {
    const h = createFixture();
    const { intent, quote, plan } = await quotedPlan(h);
    const key = crypto.randomUUID();
    const first = await createPlan(h.deps, {
      intentId: intent.id,
      quoteId: quote.id,
      accountId: ACCOUNT,
      idempotencyKey: key,
    });
    const again = await createPlan(h.deps, {
      intentId: intent.id,
      quoteId: quote.id,
      accountId: ACCOUNT,
      idempotencyKey: key,
    });
    expect(again.id).toBe(first.id);
    expect(first.id).not.toBe(plan.id);
    await expect(
      createPlan(h.deps, { intentId: intent.id, quoteId: quote.id, accountId: 'bob.near', idempotencyKey: key }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses approval of a different digest, and expires a stale quote instead of approving it', async () => {
    const h = createFixture();
    const { plan } = await quotedPlan(h);
    await expect(approvePlan(h.deps, plan.id, ACCOUNT, { digest: '0'.repeat(64) })).rejects.toThrow(
      'changed since you reviewed',
    );
    h.clock.now += 6 * 60_000;
    const expired = await approvePlan(h.deps, plan.id, ACCOUNT, { digest: plan.digest });
    expect(expired).toMatchObject({ status: 'expired', errorCode: 'QUOTE_EXPIRED' });
  });

  it('keeps every plan review-only while execution or the adapter is off', async () => {
    for (const overrides of [{ executionEnabled: false }, { writeAdapters: new Set<string>() }]) {
      const h = createFixture(overrides);
      const { plan } = await quotedPlan(h);
      await expect(approvePlan(h.deps, plan.id, ACCOUNT, { digest: plan.digest })).rejects.toMatchObject({
        code: 'EXECUTION_DISABLED',
      });
      expect((await readPlan(h.deps, plan.id, ACCOUNT)).status).toBe('awaiting_review');
    }
  });

  it('lets only the plan’s own account read or approve it', async () => {
    const h = createFixture();
    const { plan } = await quotedPlan(h);
    await expect(readPlan(h.deps, plan.id, 'bob.near')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(approvePlan(h.deps, plan.id, 'bob.near', { digest: plan.digest })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await readPlan(h.deps, plan.id, ACCOUNT)).status).toBe('awaiting_review');
  });

  it('refuses a plan for something that is not an account ID', async () => {
    const h = createFixture();
    await expect(quotedPlan(h, 'Not An Account!')).rejects.toThrow('Connect a wallet');
    await expect(quotedPlan(h, 'alice.testnet')).rejects.toThrow('different network');
  });
});

describe('recovery', () => {
  it('expires approvals whose window closed without a signature, and nothing else', async () => {
    const h = createFixture();
    const { plan: waiting } = await quotedPlan(h);
    const { plan: approved } = await quotedPlan(h);
    await approvePlan(h.deps, approved.id, ACCOUNT, { digest: approved.digest });
    h.clock.now += 6 * 60_000;
    expect((await recoverPendingPlans(h.deps)).expired).toBeGreaterThanOrEqual(1);
    expect((await readPlan(h.deps, approved.id, ACCOUNT)).status).toBe('expired');
    expect((await readPlan(h.deps, waiting.id, ACCOUNT)).status).toBe('awaiting_review');
  });
});

describe('activity', () => {
  it('lists only plans that reached the network, for that account', async () => {
    const h = createFixture();
    const { plan } = await quotedPlan(h);
    await env.DB.prepare('UPDATE plans SET tx_hash = ? WHERE id = ?').bind(`tx-${plan.id}`, plan.id).run();
    const { items } = await listActivity(h.deps, ACCOUNT);
    expect(items.find((item) => item.id === plan.id)).toMatchObject({
      title: 'Swap USDC → NEAR',
      venue: 'oneclick',
      explorerUrl: `https://nearblocks.io/txns/tx-${plan.id}`,
    });
    expect((await listActivity(h.deps, 'bob.near')).items.find((item) => item.id === plan.id)).toBeUndefined();
    await expect(listActivity(h.deps, 'G')).rejects.toThrow('valid account');
  });
});

describe('execution routes', () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    exports.default.fetch(`${ORIGIN}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('validate input before touching the database', async () => {
    const cookie = await sessionCookie(ACCOUNT);
    expect((await post('/intents', { kind: 'supply' })).status).toBe(400);
    expect((await post('/plans', { intentId: crypto.randomUUID() }, { cookie })).status).toBe(400);
    expect((await post(`/plans/${crypto.randomUUID()}/approve`, { digest: 'x' }, { cookie })).status).toBe(400);
    expect((await exports.default.fetch(`${ORIGIN}/api/plans/not-a-uuid`, { headers: { cookie } })).status).toBe(404);
  });

  it('refuse plans to anonymous callers, and take the account from the session, never the body', async () => {
    const plan = { intentId: crypto.randomUUID(), quoteId: crypto.randomUUID() };
    const key = { 'idempotency-key': crypto.randomUUID() };
    expect((await post('/plans', plan, key)).status).toBe(401);
    expect((await exports.default.fetch(`${ORIGIN}/api/plans`)).status).toBe(401);
    expect((await exports.default.fetch(`${ORIGIN}/api/plans/${crypto.randomUUID()}`)).status).toBe(401);
    expect((await post(`/plans/${crypto.randomUUID()}/approve`, { digest: '0'.repeat(64) })).status).toBe(401);

    // Not ACCOUNT: earlier tests leave it plans on a test-only asset the real registry does not know.
    const cookie = await sessionCookie('carol.near');
    const named = await post('/plans', { ...plan, accountId: 'bob.near' }, { ...key, cookie });
    expect(named.status).toBe(400);
    const listed = await exports.default.fetch(`${ORIGIN}/api/plans`, { headers: { cookie } });
    expect(listed.status).toBe(200);
  });

  it('list the assets this network can swap', async () => {
    const response = await exports.default.fetch(`${ORIGIN}/api/assets`);
    expect(response.status).toBe(200);
    const body = await response.json<{ network: string; assets: { symbol: string }[] }>();
    expect(body.network).toBe('mainnet');
    expect(body.assets.map((asset) => asset.symbol)).toEqual(expect.arrayContaining(['NEAR', 'USDC', 'USDC.arb']));
  });
});
