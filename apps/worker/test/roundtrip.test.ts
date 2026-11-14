import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { runAutomations } from '../src/automations/dispatch.ts';
import { previewRoundtrip } from '../src/automations/roundtrip.ts';
import {
  type AutomationDeps,
  activateRule,
  createRule,
  deleteRule,
  pauseRule,
  readRule,
} from '../src/automations/rules.ts';
import { executionDeps } from '../src/execution/store.ts';
import { createSwapIntent } from '../src/execution/swap.ts';

function fixture(returnAmount = 101_000_000n) {
  const deps = executionDeps(env);
  const assets = deps.assets.list().filter((asset) => asset.decimals === 6);
  const sell = assets[0];
  const buy = assets[1];
  if (!sell || !buy) throw new Error('Missing fixture assets');
  let clock = 1_900_000_000_000;
  const inputs: bigint[] = [];
  deps.now = () => clock;
  deps.venue = {
    id: 'oneclick',
    async quote(request) {
      inputs.push(request.amountIn);
      const out = inputs.length === 1 ? 200_000_000n : returnAmount;
      return {
        amountIn: request.amountIn,
        amountOut: out + 1n,
        minAmountOut: out,
        priceImpactBps: null,
        platform: 'NEAR Intents',
        protocols: [],
        raw: {},
      };
    },
  };
  return {
    deps,
    inputs,
    sell,
    buy,
    advance: () => {
      clock += 30_000;
    },
    input: { sellAssetId: sell.canonicalId, buyAssetId: buy.canonicalId, amount: '100', minSpreadBps: 0 },
  };
}

describe('read-only roundtrip monitor', () => {
  it('quotes the return using only the outbound minimum and never labels net profit', async () => {
    const h = fixture();
    const result = await previewRoundtrip(h.deps, h.input);
    expect(h.inputs).toEqual([100_000_000n, 200_000_000n]);
    expect(result).toMatchObject({
      status: 'opportunity',
      grossSpreadBps: '100.00',
      amountReturned: '101',
      netProfit: null,
      executionAvailable: false,
      atomic: false,
    });
  });
  it('requires a positive spread and honors the threshold', async () => {
    for (const amount of [100_000_000n, 99_000_000n]) {
      const h = fixture(amount);
      expect((await previewRoundtrip(h.deps, h.input)).status).toBe('below_threshold');
    }
    const h = fixture();
    h.input.minSpreadBps = 101;
    expect((await previewRoundtrip(h.deps, h.input)).status).toBe('below_threshold');
  });
  it('treats failure and stale quotes as unknown, not a false opportunity', async () => {
    const h = fixture();
    if (!h.deps.venue) throw new Error('Missing fixture venue');
    h.deps.venue.quote = async () => {
      throw new Error('provider secret must not leak');
    };
    const result = await previewRoundtrip(h.deps, h.input);
    expect(result.status).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('secret');
    const stale = fixture();
    if (!stale.deps.venue) throw new Error('Missing fixture venue');
    const quote = stale.deps.venue.quote;
    stale.deps.venue.quote = async (request) => {
      stale.advance();
      return quote(request);
    };
    expect((await previewRoundtrip(stale.deps, stale.input)).status).toBe('unknown');
  });
  it('rejects unsupported assets, excess precision and zero amounts', async () => {
    const h = fixture();
    for (const input of [
      { ...h.input, sellAssetId: 'nep141:unknown' },
      { ...h.input, amount: '0' },
      { ...h.input, amount: '1.0000001' },
    ]) {
      await expect(previewRoundtrip(h.deps, input)).rejects.toThrow();
    }
  });
  it('retains exact canonical assets when creating an unsigned review intent', async () => {
    const h = fixture();
    const result = await createSwapIntent(h.deps, {
      sell: h.sell.canonicalId,
      buy: h.buy.canonicalId,
      amount: '100',
      source: 'form',
    });
    expect(result.sell.canonicalId).toBe(h.sell.canonicalId);
    expect(result.buy.canonicalId).toBe(h.buy.canonicalId);
    await expect(
      createSwapIntent(h.deps, { sell: h.sell.symbol, buy: h.sell.canonicalId, amount: '100', source: 'form' }),
    ).rejects.toThrow();
  });
});

describe('periodic round-trip monitors', () => {
  it('persists a draft, evaluates only after activation, saves evidence and stops a one-shot alert', async () => {
    const h = fixture();
    const deps: AutomationDeps = {
      db: env.DB,
      network: 'mainnet',
      now: h.deps.now,
      quotes: {
        read: async () => {
          throw new Error('wrong evaluator');
        },
      },
      roundtrip: (config) => previewRoundtrip(h.deps, config),
    };
    const rule = await createRule(deps, {
      kind: 'roundtrip_alert',
      account: 'alice.near',
      config: { ...h.input, cooldownMinutes: 1, mode: 'once' },
    });
    expect(rule.kind).toBe('roundtrip_alert');
    await runAutomations(deps);
    expect((await readRule(deps, rule.id)).evaluations).toHaveLength(0);
    await activateRule(deps, rule.id, { revision: rule.revision, configHash: rule.configHash });
    await Promise.all([runAutomations(deps), runAutomations(deps)]);
    const state = await readRule(deps, rule.id);
    expect(state.status).toBe('completed');
    expect(state.alerts).toHaveLength(1);
    expect(state.evaluations).toHaveLength(1);
    expect(state.evaluations[0]?.evidence).toMatchObject({
      status: 'opportunity',
      grossSpreadBps: '100.00',
      executionAvailable: false,
    });
    await deleteRule(deps, rule.id);
  });
  it('records unavailable routes as unknown without alerts and pause stops later checks', async () => {
    const h = fixture();
    const deps: AutomationDeps = {
      db: env.DB,
      network: 'mainnet',
      now: h.deps.now,
      quotes: {
        read: async () => {
          throw new Error('wrong evaluator');
        },
      },
      roundtrip: async () => {
        throw new Error('provider unavailable');
      },
    };
    const rule = await createRule(deps, {
      kind: 'roundtrip_alert',
      account: 'alice.near',
      config: { ...h.input, cooldownMinutes: 1, mode: 'repeat' },
    });
    await activateRule(deps, rule.id, { revision: rule.revision, configHash: rule.configHash });
    await runAutomations(deps);
    let state = await readRule(deps, rule.id);
    expect(state.lastResult).toBe('unknown');
    expect(state.alerts).toHaveLength(0);
    await pauseRule(deps, rule.id);
    h.advance();
    h.advance();
    await runAutomations(deps);
    state = await readRule(deps, rule.id);
    expect(state.evaluations).toHaveLength(1);
    await deleteRule(deps, rule.id);
  });
});
