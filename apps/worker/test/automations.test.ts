import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { PriceAlertConfig } from '../src/automations/config.ts';
import { runAutomations } from '../src/automations/dispatch.ts';
import { compareDecimal } from '../src/automations/evaluate.ts';
import {
  type AutomationDeps,
  acknowledgeTrigger,
  activateRule,
  createRule,
  deleteRule,
  pauseRule,
  readRule,
  reviseRule,
} from '../src/automations/rules.ts';
import { sessionCookie } from './session.ts';

const ORIGIN = 'https://harbor.test';
const ACCOUNT = 'alice.near';
const MINUTE = 60_000;
const CONFIG: PriceAlertConfig = {
  sell: { assetId: 'nep141:wrap.near', symbol: 'NEAR', amount: '10' },
  buy: { assetId: 'nep141:usdc.example.near', symbol: 'USDC' },
  minOutput: '40',
  cooldownMinutes: 5,
  mode: 'repeat',
};
const BELOW = '38.5';
const ABOVE = '41.2';

function createFixture(startMs: number) {
  const clock = { now: startMs };
  // What the venue quotes for the rule's sell amount; null makes the venue unreadable.
  const quote: { output: string | null } = { output: BELOW };
  const deps: AutomationDeps = {
    db: env.DB,
    network: 'mainnet',
    now: () => clock.now,
    quotes: {
      read: async () => {
        if (quote.output === null) throw new Error('The quote venue is unreachable.');
        return { amountOut: quote.output, venue: 'oneclick', observedAtMs: clock.now };
      },
    },
  };
  return { deps, clock, quote };
}

async function activeRule(h: ReturnType<typeof createFixture>, config: PriceAlertConfig = CONFIG) {
  const draft = await createRule(h.deps, { account: ACCOUNT, config });
  return activateRule(h.deps, draft.id, { revision: draft.revision, configHash: draft.configHash });
}

async function tick(h: ReturnType<typeof createFixture>) {
  const summary = await runAutomations(h.deps);
  h.clock.now += MINUTE;
  return summary;
}

describe('price alert rules', () => {
  it('saves a draft that only the reviewed revision and hash can activate', async () => {
    const h = createFixture(1_900_000_000_000);
    const draft = await createRule(h.deps, { config: CONFIG });
    expect(draft).toMatchObject({ status: 'draft', revision: 1, name: '10 NEAR → USDC ≥ 40' });
    await expect(activateRule(h.deps, draft.id, { revision: 1, configHash: '0'.repeat(64) })).rejects.toThrow(
      'changed since you reviewed it',
    );
    const revised = await reviseRule(h.deps, draft.id, {
      expectedRevision: 1,
      config: { ...CONFIG, minOutput: '42' },
    });
    expect(revised).toMatchObject({ status: 'draft', revision: 2 });
    await expect(activateRule(h.deps, draft.id, { revision: 1, configHash: draft.configHash })).rejects.toThrow(
      'changed since you reviewed it',
    );
    const active = await activateRule(h.deps, draft.id, { revision: 2, configHash: revised.configHash });
    expect(active).toMatchObject({ status: 'active', config: { minOutput: '42' } });
    await deleteRule(h.deps, draft.id);
  });

  it('rejects the same asset on both sides and an empty amount', async () => {
    const h = createFixture(1_900_000_000_000);
    await expect(
      createRule(h.deps, { config: { ...CONFIG, buy: { assetId: CONFIG.sell.assetId, symbol: 'NEAR' } } }),
    ).rejects.toThrow('two different assets');
    await expect(createRule(h.deps, { config: { ...CONFIG, sell: { ...CONFIG.sell, amount: '0' } } })).rejects.toThrow(
      'above zero',
    );
    await expect(createRule(h.deps, { account: 'G'.repeat(56), config: CONFIG })).rejects.toThrow('valid account');
  });
});

describe('scheduled checks', () => {
  it('alerts once when the price reaches the target, re-arms below it, and respects the cooldown', async () => {
    const h = createFixture(1_910_000_000_000);
    const rule = await activeRule(h);

    await tick(h); // below the target: false
    h.quote.output = ABOVE;
    await tick(h); // true: alert
    await tick(h); // still true: disarmed, no second alert
    let state = await readRule(h.deps, rule.id);
    expect(state.evaluations.map((evaluation) => [evaluation.result, evaluation.triggered])).toEqual([
      ['true', false],
      ['true', true],
      ['false', false],
    ]);
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]?.summary).toMatch(/^10 NEAR quotes 41\.2 USDC on oneclick, at or above the 40 USDC target/);
    expect(state).toMatchObject({ armed: false, lastResult: 'true' });

    h.quote.output = BELOW;
    await tick(h); // false: re-armed
    h.quote.output = ABOVE;
    await tick(h); // true but within the 5-minute cooldown of the first alert
    state = await readRule(h.deps, rule.id);
    expect(state.alerts).toHaveLength(1);
    h.clock.now += 5 * MINUTE;
    await tick(h); // cooldown over: second alert
    state = await readRule(h.deps, rule.id);
    expect(state.alerts).toHaveLength(2);

    const outbox = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM outbox WHERE topic = 'automation.alert' AND payload LIKE ?",
    )
      .bind(`%${rule.id}%`)
      .first<{ count: number }>();
    expect(outbox?.count).toBe(2);
    await deleteRule(h.deps, rule.id);
  });

  it('records unknown, without alerting or re-arming, when the swap cannot be quoted', async () => {
    const h = createFixture(1_920_000_000_000);
    const rule = await activeRule(h);
    h.quote.output = null;
    await tick(h);
    const state = await readRule(h.deps, rule.id);
    expect(state.evaluations[0]).toMatchObject({ result: 'unknown', triggered: false });
    expect(state.evaluations[0]?.reason).toContain('quote venue is unreachable');
    expect(state.alerts).toHaveLength(0);
    await deleteRule(h.deps, rule.id);
  });

  it('completes a one-shot rule after its first alert', async () => {
    const h = createFixture(1_930_000_000_000);
    h.quote.output = ABOVE;
    const rule = await activeRule(h, { ...CONFIG, mode: 'once' });
    await tick(h);
    await tick(h);
    const state = await readRule(h.deps, rule.id);
    expect(state).toMatchObject({ status: 'completed', nextCheckAt: null });
    expect(state.evaluations).toHaveLength(1);
    expect(state.alerts).toHaveLength(1);
    await deleteRule(h.deps, rule.id);
  });

  it('never evaluates a paused rule or a revision replaced after its check was queued', async () => {
    const h = createFixture(1_940_000_000_000);
    h.quote.output = ABOVE;
    const rule = await activeRule(h);
    await pauseRule(h.deps, rule.id);
    await tick(h);
    expect((await readRule(h.deps, rule.id)).evaluations).toHaveLength(0);

    const draft = await reviseRule(h.deps, rule.id, { expectedRevision: 1, config: CONFIG });
    await activateRule(h.deps, rule.id, { revision: 2, configHash: draft.configHash });
    // Queue revision 2's check, then replace the revision before it runs.
    await env.DB.prepare(
      `INSERT INTO jobs (id, kind, status, payload, dedupe_key, attempts, max_attempts, run_after_ms, created_at_ms, updated_at_ms)
       VALUES (?, 'automation.evaluate', 'queued', ?, ?, 0, 3, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        JSON.stringify({ ruleId: rule.id, revision: 2, scheduledForMs: h.clock.now }),
        `stale:${rule.id}`,
        h.clock.now,
        h.clock.now,
        h.clock.now,
      )
      .run();
    await reviseRule(h.deps, rule.id, { expectedRevision: 2, config: CONFIG });
    await tick(h);
    expect((await readRule(h.deps, rule.id)).evaluations).toHaveLength(0);
    await deleteRule(h.deps, rule.id);
  });

  it('fires one alert when two scheduler invocations overlap', async () => {
    const h = createFixture(1_950_000_000_000);
    h.quote.output = ABOVE;
    const rule = await activeRule(h);
    await Promise.all([runAutomations(h.deps), runAutomations(h.deps)]);
    const state = await readRule(h.deps, rule.id);
    expect(state.evaluations).toHaveLength(1);
    expect(state.alerts).toHaveLength(1);
    await expect(acknowledgeTrigger(h.deps, state.alerts[0]?.id ?? '', 'bob.near')).rejects.toThrow('No such alert');
    await acknowledgeTrigger(h.deps, state.alerts[0]?.id ?? '', ACCOUNT);
    expect((await readRule(h.deps, rule.id)).alerts[0]?.acknowledgedAt).not.toBeNull();
    await deleteRule(h.deps, rule.id);
  });
});

describe('automation routes', () => {
  const request = (path: string, cookie: string, init: { method?: string; body?: unknown } = {}) =>
    exports.default.fetch(`${ORIGIN}/api/automations${path}`, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', cookie },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

  it('creates a draft for the signed-in account and validates settings over HTTP', async () => {
    const alice = await sessionCookie(ACCOUNT);
    const created = await request('', alice, { method: 'POST', body: { kind: 'price_alert', config: CONFIG } });
    expect(created.status).toBe(201);
    const rule = (await created.json()) as { id: string; status: string; account: string };
    expect(rule).toMatchObject({ status: 'draft', account: ACCOUNT });
    const listed = (await (await request('', alice)).json()) as { automations: { id: string }[] };
    expect(listed.automations.map((entry) => entry.id)).toContain(rule.id);
    const invalid = await request('', alice, {
      method: 'POST',
      body: { kind: 'price_alert', config: { ...CONFIG, minOutput: '0' } },
    });
    expect(invalid.status).toBe(400);
  });

  it('refuses anonymous callers and hides one account’s rules from another', async () => {
    expect((await request('', '')).status).toBe(401);
    expect((await request('', '', { method: 'POST', body: { kind: 'price_alert', config: CONFIG } })).status).toBe(401);

    const alice = await sessionCookie(ACCOUNT);
    const bob = await sessionCookie('bob.near');
    const rule = (await (
      await request('', alice, { method: 'POST', body: { kind: 'price_alert', config: CONFIG } })
    ).json()) as { id: string; revision: number; configHash: string };

    const listed = (await (await request('', bob)).json()) as { automations: { id: string }[] };
    expect(listed.automations.map((entry) => entry.id)).not.toContain(rule.id);
    expect((await request(`/${rule.id}`, bob)).status).toBe(404);
    const activate = { revision: rule.revision, configHash: rule.configHash };
    expect((await request(`/${rule.id}/activate`, bob, { method: 'POST', body: activate })).status).toBe(404);
    expect((await request(`/${rule.id}`, bob, { method: 'DELETE' })).status).toBe(404);
    expect((await request(`/${rule.id}`, alice)).status).toBe(200);
  });
});

describe('compareDecimal', () => {
  it('compares plain decimals exactly, whatever their scale', () => {
    expect(compareDecimal('41.2', '40')).toBe(1);
    expect(compareDecimal('40.000', '40')).toBe(0);
    expect(compareDecimal('39.999999999999999999999999', '40')).toBe(-1);
  });
});
