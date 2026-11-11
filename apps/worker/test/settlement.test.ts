import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { assetRegistry } from '../src/execution/assets.ts';
import { approvePlan, compareIntent, createPlan, intentSetup, readPlan } from '../src/execution/lifecycle.ts';
import { recoverPendingPlans } from '../src/execution/recovery.ts';
import { recordDeposit, settlePlans } from '../src/execution/settlement.ts';
import type { ExecutionDeps } from '../src/execution/store.ts';
import { createSwapIntent } from '../src/execution/swap.ts';
import { chainResult, fakeWorld, report, txHash } from './execution-fakes.ts';

const USDC_CONTRACT = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const AMOUNT_OUT = 3_500_000n; // 3.5 USDC
const HOUR = 60 * 60_000;

function setup() {
  const clock = { now: Date.now() };
  const fakes = fakeWorld(clock, AMOUNT_OUT);
  const deps: ExecutionDeps = {
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
        amountOut: AMOUNT_OUT,
        minAmountOut: fakes.world.minOut,
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
  return { deps, clock, world: fakes.world };
}

/** A NEAR → USDC plan the owner has approved, with the recipient's USDC balance recorded at 100. */
async function approvedPlan(h: ReturnType<typeof setup>, account: string, buy = 'USDC') {
  h.world.balances.set(`${USDC_CONTRACT}:${account}`, 100n);
  const intent = await createSwapIntent(h.deps, { sell: 'NEAR', buy, amount: '1', source: 'form' });
  const [quote] = (await compareIntent(h.deps, intent.id)).quotes;
  if (!quote) throw new Error('no quote');
  const plan = await createPlan(h.deps, {
    intentId: intent.id,
    quoteId: quote.id,
    accountId: account,
    idempotencyKey: crypto.randomUUID(),
  });
  return approvePlan(h.deps, plan.id, account, { digest: plan.digest });
}

/** The owner's wallet sends exactly the transaction Harbor asked it to sign. */
function walletSends(
  h: ReturnType<typeof setup>,
  plan: Awaited<ReturnType<typeof approvedPlan>>,
  change?: (args: Record<string, unknown>) => void,
) {
  if (!plan.signing) throw new Error('nothing to sign');
  const signing = structuredClone(plan.signing);
  if (change) change(signing.actions.at(-1)?.params.args as Record<string, unknown>);
  const hash = txHash();
  h.world.transactions.set(hash, chainResult(plan.account, signing));
  return hash;
}

async function events(planId: string) {
  const { results } = await env.DB.prepare('SELECT to_status, reason FROM plan_events WHERE plan_id = ? ORDER BY id')
    .bind(planId)
    .all<{ to_status: string; reason: string }>();
  return results.map((row) => row.to_status);
}

describe('signing a deposit', () => {
  it('hands the wallet one transaction: register, wrap and transfer exactly the planned amount', async () => {
    const h = setup();
    const plan = await approvedPlan(h, 'signer.near');
    expect(plan.status).toBe('awaiting_signature');
    expect(plan.signing?.receiverId).toBe('wrap.near');
    expect(plan.signing?.actions.map((action) => action.params.methodName)).toEqual([
      'storage_deposit',
      'near_deposit',
      'ft_transfer',
    ]);
    expect(plan.signing?.actions.at(-1)?.params.args).toEqual({
      receiver_id: plan.depositAddress,
      amount: '1000000000000000000000000',
    });
    expect(h.world.quotes.at(-1)).toMatchObject({ refundTo: 'signer.near', recipient: 'signer.near' });
  });
});

describe('account setup', () => {
  it('asks a new account to register on both tokens before 1Click can quote it, and nothing else', async () => {
    const h = setup();
    const account = 'newcomer.near';
    h.world.unregistered.add(`wrap.near:${account}`);
    h.world.unregistered.add(`${USDC_CONTRACT}:${account}`);
    const intent = await createSwapIntent(h.deps, { sell: 'NEAR', buy: 'USDC', amount: '1', source: 'form' });
    const [quote] = (await compareIntent(h.deps, intent.id)).quotes;
    if (!quote) throw new Error('no quote');
    const plan = { intentId: intent.id, quoteId: quote.id, accountId: account, idempotencyKey: crypto.randomUUID() };
    await expect(createPlan(h.deps, plan)).rejects.toMatchObject({ code: 'SETUP_REQUIRED' });
    expect(h.world.quotes).toHaveLength(0);

    const { transactions } = await intentSetup(h.deps, intent.id, account);
    expect(transactions.map((transaction) => transaction.receiverId)).toEqual(['wrap.near', USDC_CONTRACT]);
    expect(transactions[0]?.actions[0]?.params).toMatchObject({
      methodName: 'storage_deposit',
      args: { account_id: account, registration_only: true },
      deposit: '1250000000000000000000',
    });

    h.world.unregistered.clear();
    expect((await intentSetup(h.deps, intent.id, account)).transactions).toEqual([]);
    expect((await createPlan(h.deps, plan)).status).toBe('awaiting_review');
  });
});

describe('settling a swap', () => {
  it('accepts the planned deposit, follows the provider, and confirms only once the delivery is on chain', async () => {
    const h = setup();
    const plan = await approvedPlan(h, 'happy.near');
    const submitted = await recordDeposit(h.deps, plan.id, 'happy.near', walletSends(h, plan));
    expect(submitted).toMatchObject({ status: 'submitted', signing: null });
    expect(h.world.notices.at(-1)).toMatchObject({ sender: 'happy.near' });

    h.world.report = report('PROCESSING');
    await settlePlans(h.deps);
    expect((await readPlan(h.deps, plan.id, 'happy.near')).status).toBe('confirming');

    // 1Click says success, but nothing has arrived yet: still not confirmed.
    h.world.report = report('SUCCESS', { amountOut: AMOUNT_OUT, deliveryTxHashes: ['delivery-tx'] });
    await settlePlans(h.deps);
    expect((await readPlan(h.deps, plan.id, 'happy.near')).status).toBe('confirming');

    h.world.balances.set(`${USDC_CONTRACT}:happy.near`, 100n + h.world.minOut);
    await settlePlans(h.deps);
    const confirmed = await readPlan(h.deps, plan.id, 'happy.near');
    expect(confirmed).toMatchObject({ status: 'confirmed', deliveryVerified: true, oneClickStatus: 'SUCCESS' });
    expect(await events(plan.id)).toEqual([
      'awaiting_review',
      'awaiting_signature',
      'submitted',
      'confirming',
      'confirming',
      'confirmed',
    ]);
  });

  it('records a refund as a refund, never a success', async () => {
    const h = setup();
    const plan = await approvedPlan(h, 'refund.near');
    await recordDeposit(h.deps, plan.id, 'refund.near', walletSends(h, plan));
    h.world.report = report('REFUNDED', {
      refundedAmount: 1_000_000_000_000_000_000_000_000n,
      refundReason: 'Price moved',
    });
    await settlePlans(h.deps);
    const refunded = await readPlan(h.deps, plan.id, 'refund.near');
    expect(refunded).toMatchObject({ status: 'refunded', deliveryVerified: false, oneClickStatus: 'REFUNDED' });
  });

  it('never treats a missing status or an unverifiable success as "did not happen"', async () => {
    const h = setup();
    const quiet = await approvedPlan(h, 'quiet.near');
    await recordDeposit(h.deps, quiet.id, 'quiet.near', walletSends(h, quiet));
    h.world.report = new Error('1Click is down');
    await settlePlans(h.deps);
    expect((await readPlan(h.deps, quiet.id, 'quiet.near')).status).toBe('submitted');
    h.clock.now += 3 * HOUR;
    await settlePlans(h.deps);
    expect(await readPlan(h.deps, quiet.id, 'quiet.near')).toMatchObject({
      status: 'outcome_unknown',
      errorCode: 'STATUS_UNAVAILABLE',
    });

    const unproven = await approvedPlan(h, 'unproven.near');
    await recordDeposit(h.deps, unproven.id, 'unproven.near', walletSends(h, unproven));
    h.world.report = report('SUCCESS', { deliveryTxHashes: ['somewhere'] });
    await settlePlans(h.deps);
    h.clock.now += 3 * HOUR;
    await settlePlans(h.deps);
    expect(await readPlan(h.deps, unproven.id, 'unproven.near')).toMatchObject({
      status: 'outcome_unknown',
      errorCode: 'DELIVERY_UNVERIFIED',
    });
  });

  it('maps an incomplete deposit to unknown and a provider failure to failed', async () => {
    const h = setup();
    const short = await approvedPlan(h, 'short.near');
    await recordDeposit(h.deps, short.id, 'short.near', walletSends(h, short));
    h.world.report = report('INCOMPLETE_DEPOSIT');
    await settlePlans(h.deps);
    expect((await readPlan(h.deps, short.id, 'short.near')).status).toBe('outcome_unknown');

    const broken = await approvedPlan(h, 'broken.near');
    await recordDeposit(h.deps, broken.id, 'broken.near', walletSends(h, broken));
    h.world.report = report('FAILED');
    await settlePlans(h.deps);
    expect(await readPlan(h.deps, broken.id, 'broken.near')).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_FAILED',
    });
  });

  it('verifies an EVM delivery from the receipt on that chain', async () => {
    const h = setup();
    const account = 'evm.near';
    const recipient = '0xa11ce00000000000000000000000000000000000';
    await env.DB.prepare(
      `INSERT INTO policies (id, network, owner_account, revision, body, digest, message, nonce, status, signed_at_ms,
         expires_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, 'mainnet', ?, 1, ?, 'd', 'm', ?, 'active', ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        account,
        JSON.stringify({
          version: 'harbor.policy.v1',
          network: 'mainnet',
          owner: account,
          allowedAssets: ['nep141:wrap.near', BASE_USDC],
          spend: [{ assetId: 'nep141:wrap.near', perActionMaxRaw: '5', dailyMaxRaw: '5', totalMaxRaw: '5' }],
          destinations: [{ chain: 'base', address: recipient }],
          slippageMaxBps: 50,
          quoteMaxAgeSeconds: 60,
          schedule: { kind: 'once' },
          validFrom: new Date(h.clock.now - HOUR).toISOString(),
          expiresAt: new Date(h.clock.now + 24 * HOUR).toISOString(),
        }),
        crypto.randomUUID(),
        h.clock.now,
        h.clock.now + 24 * HOUR,
        h.clock.now,
        h.clock.now,
      )
      .run();
    const plan = await approvedPlan(h, account, 'USDC.base');
    expect(plan.recipient).toEqual({ chain: 'base', address: recipient });
    await recordDeposit(h.deps, plan.id, account, walletSends(h, plan));
    const delivery = `0x${'ab'.repeat(32)}`;
    h.world.receipts.set(delivery, {
      status: '0x1',
      logs: [
        {
          address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            `0x${'0'.repeat(64)}`,
            `0x${'0'.repeat(24)}${recipient.slice(2)}`,
          ],
          data: `0x${h.world.minOut.toString(16)}`,
        },
      ],
    });
    h.world.report = report('SUCCESS', { deliveryTxHashes: [delivery] });
    await settlePlans(h.deps);
    expect(await readPlan(h.deps, plan.id, account)).toMatchObject({ status: 'confirmed', deliveryVerified: true });
  });
});

describe('deposit checks', () => {
  it('refuses a transaction that is not the planned deposit, and lets the right one through after', async () => {
    const h = setup();
    const plan = await approvedPlan(h, 'careful.near');
    const wrong = walletSends(h, plan, (args) => {
      args.amount = '1';
    });
    await expect(recordDeposit(h.deps, plan.id, 'careful.near', wrong)).rejects.toThrow("not this plan's deposit");
    expect((await readPlan(h.deps, plan.id, 'careful.near')).status).toBe('awaiting_signature');
    await expect(recordDeposit(h.deps, plan.id, 'mallory.near', walletSends(h, plan))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await recordDeposit(h.deps, plan.id, 'careful.near', walletSends(h, plan))).status).toBe('submitted');
  });

  it('keeps a deposit it cannot read yet, and settles it on a later tick', async () => {
    const h = setup();
    const plan = await approvedPlan(h, 'patient.near');
    const hash = walletSends(h, plan);
    h.world.down = true;
    const claimed = await recordDeposit(h.deps, plan.id, 'patient.near', hash);
    expect(claimed).toMatchObject({ status: 'awaiting_signature', txHash: hash });
    h.world.down = false;
    await settlePlans(h.deps);
    // Verified, then followed with the provider in the same tick.
    expect((await readPlan(h.deps, plan.id, 'patient.near')).status).toBe('confirming');
  });

  it('still accepts a deposit that lands after the approval window closed', async () => {
    const h = setup();
    const plan = await approvedPlan(h, 'late.near');
    h.clock.now += 6 * 60_000;
    await recoverPendingPlans(h.deps);
    expect((await readPlan(h.deps, plan.id, 'late.near')).status).toBe('expired');
    expect((await recordDeposit(h.deps, plan.id, 'late.near', walletSends(h, plan))).status).toBe('submitted');
  });

  it('marks a deposit that failed on chain as failed, since nothing moved', async () => {
    const h = setup();
    const plan = await approvedPlan(h, 'failing.near');
    const hash = txHash();
    if (!plan.signing) throw new Error('nothing to sign');
    h.world.transactions.set(hash, chainResult('failing.near', plan.signing, { Failure: { ActionError: {} } }));
    expect(await recordDeposit(h.deps, plan.id, 'failing.near', hash)).toMatchObject({
      status: 'failed',
      errorCode: 'DEPOSIT_FAILED',
    });
  });
});
