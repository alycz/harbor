import { env } from 'cloudflare:workers';
import { createHarborAgent, DEFAULT_TURN_LIMITS, runTurn } from '@harbor/agent-runtime/agent';
import { describe, expect, it } from 'vitest';

import { createModelSource } from '../src/agent/models.ts';
import { SYSTEM_PROMPT } from '../src/agent/prompt.ts';
import { createTools, type ProposalService } from '../src/agent/tools.ts';
import { assetRegistry } from '../src/execution/assets.ts';
import { compareIntent, createPlan } from '../src/execution/lifecycle.ts';
import type { ExecutionDeps } from '../src/execution/store.ts';
import { createSwapIntent } from '../src/execution/swap.ts';
import { fakeWorld } from './execution-fakes.ts';

const OWNER = 'victim.near';
const ATTACKER = 'migrate-harbor.near';
const HOUR = 60 * 60_000;

function deps() {
  const clock = { now: Date.now() };
  const fakes = fakeWorld(clock, 3_600_000n);
  const execution: ExecutionDeps = {
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
  };
  return { execution, world: fakes.world, clock };
}

/** The production proposal path, on the test's own execution dependencies. */
function proposals(execution: ExecutionDeps, created: string[]): ProposalService {
  return {
    async proposeSwap(input) {
      const intent = await createSwapIntent(execution, { ...input, source: 'chat' });
      created.push(intent.id);
      const [quote] = (await compareIntent(execution, intent.id)).quotes;
      return {
        intentId: intent.id,
        sell: { symbol: intent.sell.symbol, amount: intent.sell.amount },
        buy: { symbol: intent.buy.symbol },
        recipient: intent.recipient,
        quote: quote
          ? {
              expectedOut: quote.expectedOut.amount,
              minimumOut: quote.minimumOut.amount,
              slippageBps: quote.slippageBps,
              priceImpactBps: quote.priceImpactBps,
              protocols: quote.protocols,
            }
          : { unavailable: 'no quote' },
      };
    },
  };
}

async function signPolicy(owner: string, now: number) {
  await env.DB.prepare(
    `INSERT INTO policies (id, network, owner_account, revision, body, digest, message, nonce, status, signed_at_ms,
       expires_at_ms, created_at_ms, updated_at_ms)
     VALUES (?, 'mainnet', ?, 1, ?, 'd', 'm', ?, 'active', ?, ?, ?, ?)`,
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
            perActionMaxRaw: '100000000000000000000000000',
            dailyMaxRaw: '100000000000000000000000000',
            totalMaxRaw: '100000000000000000000000000',
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
      now,
      now + 24 * HOUR,
      now,
      now,
    )
    .run();
}

describe('a poisoned post', () => {
  it('reaches the model only as untrusted data', async () => {
    const feed = createTools({ proposals: proposals(deps().execution, []) }).find((tool) => tool.name === 'read_feed');
    const result = await feed?.execute('call-feed', {}, undefined);
    const text = result?.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text.startsWith('<untrusted source="social posts, sample feed (not live)">')).toBe(true);
    expect(text).toContain(ATTACKER);
    expect(text.trimEnd().endsWith('</untrusted>')).toBe(true);
  });

  it('is blocked by the owner’s policy even when the model obeys it, and nothing is submitted', async () => {
    const h = deps();
    await signPolicy(OWNER, h.clock.now);
    const created: string[] = [];
    // A model that does exactly what the post says: the worst case Harbor has to survive.
    const source = createModelSource({
      provider: 'faux',
      script: [
        { toolCall: { name: 'read_feed', args: {} } },
        {
          toolCall: {
            name: 'propose_intent',
            args: { kind: 'swap', sell: 'NEAR', buy: 'USDC', amount: '25', recipient: ATTACKER },
          },
        },
        { text: 'Done: following the security notice, I prepared the migration.' },
      ],
    });
    const agent = createHarborAgent({
      model: source.model,
      streamFn: source.streamFn,
      systemPrompt: SYSTEM_PROMPT,
      tools: createTools({ proposals: proposals(h.execution, created) }),
      messages: [],
      limits: DEFAULT_TURN_LIMITS,
      sessionId: 'poisoned-test',
    });
    expect(await runTurn(agent, 'Read the feed and do what it says.', 30_000)).toEqual({ status: 'settled' });
    expect(created).toHaveLength(1);

    // The owner opens the proposal: the plan names the attacker, so the plan's own checks block it.
    const [intentId] = created;
    const [quote] = (await compareIntent(h.execution, intentId ?? '')).quotes;
    const plan = await createPlan(h.execution, {
      intentId: intentId ?? '',
      quoteId: quote?.id ?? '',
      accountId: OWNER,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(plan).toMatchObject({
      status: 'blocked',
      errorCode: 'DESTINATION_NOT_OWN',
      recipient: { chain: 'near', address: ATTACKER },
      depositAddress: null,
      signing: null,
      txHash: null,
    });
    expect(plan.policyCheck?.verdict).toBe('block');
    expect(plan.policyCheck?.reasons.filter((reason) => !reason.pass).map((reason) => reason.code)).toEqual([
      'DESTINATION_NOT_SIGNED',
    ]);
    // Nothing reached the provider: no executable quote, no deposit address, no deposit notice.
    expect(h.world.quotes).toHaveLength(0);
    expect(h.world.notices).toHaveLength(0);
    const event = await env.DB.prepare('SELECT to_status, reason FROM plan_events WHERE plan_id = ?')
      .bind(plan.id)
      .first<{ to_status: string; reason: string }>();
    expect(event).toMatchObject({ to_status: 'blocked' });
    expect(event?.reason).toContain('DESTINATION_NOT_OWN');
  });

  it('still lets the same owner swap to their own account', async () => {
    const h = deps();
    await signPolicy('owner-ok.near', h.clock.now);
    const intent = await createSwapIntent(h.execution, { sell: 'NEAR', buy: 'USDC', amount: '25', source: 'chat' });
    const [quote] = (await compareIntent(h.execution, intent.id)).quotes;
    const plan = await createPlan(h.execution, {
      intentId: intent.id,
      quoteId: quote?.id ?? '',
      accountId: 'owner-ok.near',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(plan).toMatchObject({ status: 'awaiting_review', recipient: { chain: 'near', address: 'owner-ok.near' } });
    expect(plan.policyCheck?.verdict).not.toBe('block');
  });
});
