import { env } from 'cloudflare:workers';
import type { RheaMarket, RheaReader } from '@harbor/adapters/rhea/lending';
import { AppError } from '@harbor/domain/errors';
import { beforeEach, describe, expect, it } from 'vitest';

import supplyTx from '../../../packages/adapters/test/fixtures/rhea-supply-tx.json' with { type: 'json' };
import { createApp } from '../src/app.ts';
import type { ExecutionConfig } from '../src/config.ts';
import {
  approvePlan,
  cancelPlan,
  createPlan,
  type LendingDeps,
  readAccount,
  readPlan,
  submitPlan,
} from '../src/lending/lifecycle.ts';

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
/** The account and hash of a real 11.171634 USDC supply on mainnet, kept as a fixture. */
const OWNER = '12fcdd4683f9cbf36a008f619cf36b56eed5058887125b0355b4fc2d4e714cd1';
const REAL_TX = 'CX3nCVEtyTH7k3fhn3NruvYJmb6XXVDMyw4YMHU1dKNh';
const REAL_AMOUNT = '11.171634';
/** A minute before the fixture's block. */
const START_MS = Date.parse('2026-11-14T19:20:42Z');
const BLOCK_MS = Date.parse('2026-11-14T19:21:42Z');

interface World {
  canDeposit: boolean;
  remainingCapRaw: bigint | null;
  registered: boolean;
  balance: bigint;
  transactions: Map<string, unknown>;
  blockMs: number;
}

function fixture(overrides: Partial<ExecutionConfig> = {}) {
  const clock = { now: START_MS };
  const world: World = {
    canDeposit: true,
    remainingCapRaw: 40_000_000_000_000n,
    registered: true,
    balance: 100_000_000n,
    transactions: new Map([[REAL_TX, supplyTx]]),
    blockMs: BLOCK_MS,
  };
  const rhea: RheaReader = {
    market: async (tokenId): Promise<RheaMarket> => ({
      tokenId,
      canDeposit: world.canDeposit,
      canWithdraw: true,
      extraDecimals: 12,
      supplyAprPct: 12.5,
      totalSuppliedRaw: 12_000_000_000_000n,
      remainingCapRaw: world.remainingCapRaw,
    }),
    registered: async () => world.registered,
    registrationDeposit: async () => 10n ** 23n,
    tokenBalance: async () => world.balance,
    supplied: async () => 0n,
    transaction: async (hash) => world.transactions.get(hash) ?? null,
    blockTimestampMs: async () => world.blockMs,
  };
  const config: ExecutionConfig = {
    network: 'mainnet',
    executionEnabled: true,
    writeAdapters: new Set(['rhea-lending']),
    oneClickJwt: null,
    rpcUrl: 'https://rpc.test',
    ...overrides,
  };
  const deps: LendingDeps = { db: env.DB, config, rhea, now: () => clock.now };
  return { deps, world, clock };
}

const key = () => `key-${crypto.randomUUID()}`;

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return 'OK';
}

describe('Rhea supply lifecycle', () => {
  // The fixture's one real hash may be recorded once per database, so each test starts empty.
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM rhea_supply_plans').run();
  });

  it('reviews, approves and confirms a real mainnet supply from the chain', async () => {
    const { deps } = fixture();
    const plan = await createPlan(deps, OWNER, { asset: 'USDC', amount: REAL_AMOUNT }, key());
    expect(plan).toMatchObject({ status: 'awaiting_review', symbol: 'USDC', tokenId: USDC, amountRaw: '11171634' });
    expect(plan.signing).toBeNull();

    const approved = await approvePlan(deps, OWNER, plan.id, { digest: plan.digest });
    expect(approved.status).toBe('awaiting_signature');
    expect(approved.signing).toEqual({
      receiverId: USDC,
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'ft_transfer_call',
            args: { receiver_id: 'contract.main.burrow.near', amount: '11171634', msg: '' },
            gas: '100000000000000',
            deposit: '1',
          },
        },
      ],
    });

    const settled = await submitPlan(deps, OWNER, plan.id, REAL_TX);
    expect(settled).toMatchObject({ status: 'confirmed', txHash: REAL_TX, verification: 'settled', signing: null });
    expect(settled.explorerUrl).toBe(`https://nearblocks.io/txns/${REAL_TX}`);
    // Settling again is harmless and changes nothing.
    expect((await submitPlan(deps, OWNER, plan.id, REAL_TX)).status).toBe('confirmed');
  });

  it('lets anyone review but only approves when Rhea deposits are switched on', async () => {
    for (const overrides of [{ executionEnabled: false }, { writeAdapters: new Set(['oneclick']) }]) {
      const { deps } = fixture(overrides);
      const plan = await createPlan(deps, OWNER, { asset: 'USDC', amount: '1' }, key());
      expect(await code(approvePlan(deps, OWNER, plan.id, { digest: plan.digest }))).toBe('EXECUTION_DISABLED');
    }
  });

  it('asks for the one-time registration, and refuses what the wallet or the market cannot take', async () => {
    const { deps, world } = fixture();
    world.registered = false;
    expect(await code(createPlan(deps, OWNER, { asset: 'USDC', amount: '1' }, key()))).toBe('SETUP_REQUIRED');
    world.registered = true;
    expect(await code(createPlan(deps, OWNER, { asset: 'USDC', amount: '101' }, key()))).toBe('INVALID_REQUEST');
    world.remainingCapRaw = 500_000n;
    expect(await code(createPlan(deps, OWNER, { asset: 'USDC', amount: '1' }, key()))).toBe('INVALID_REQUEST');
    world.remainingCapRaw = null;
    world.canDeposit = false;
    expect(await code(createPlan(deps, OWNER, { asset: 'USDC', amount: '1' }, key()))).toBe('UNAVAILABLE');
  });

  it('checks the chain again at approval: a balance spent in the meantime stops it', async () => {
    const { deps, world } = fixture();
    const plan = await createPlan(deps, OWNER, { asset: 'USDC', amount: '50' }, key());
    world.balance = 10_000_000n;
    expect(await code(approvePlan(deps, OWNER, plan.id, { digest: plan.digest }))).toBe('INVALID_REQUEST');
    expect((await readPlan(deps, OWNER, plan.id)).status).toBe('awaiting_review');
  });

  it('refuses tokens Harbor does not supply, wNEAR included, and amounts it cannot read', async () => {
    const { deps } = fixture();
    for (const asset of ['NEAR', 'nep141:wrap.near', 'DOGE', 'USDC.base']) {
      expect(await code(createPlan(deps, OWNER, { asset, amount: '1' }, key()))).toBe('INVALID_REQUEST');
    }
    for (const amount of ['0', '-1', '1.0000001', 'abc']) {
      expect(await code(createPlan(deps, OWNER, { asset: 'USDC', amount }, key()))).toBe('INVALID_REQUEST');
    }
  });

  it('approves only the digest that was reviewed, and only within the review window', async () => {
    const { deps, clock } = fixture();
    const plan = await createPlan(deps, OWNER, { asset: 'USDC', amount: '1' }, key());
    expect(await code(approvePlan(deps, OWNER, plan.id, { digest: '0'.repeat(64) }))).toBe('CONFLICT');
    clock.now += 11 * 60_000;
    expect(await code(approvePlan(deps, OWNER, plan.id, { digest: plan.digest }))).toBe('CONFLICT');
    expect((await readPlan(deps, OWNER, plan.id)).status).toBe('expired');
  });

  it('replays a retried request, and refuses its key for a different deposit', async () => {
    const { deps } = fixture();
    const same = key();
    const first = await createPlan(deps, OWNER, { asset: 'USDC', amount: '2' }, same);
    expect((await createPlan(deps, OWNER, { asset: 'USDC', amount: '2' }, same)).id).toBe(first.id);
    expect(await code(createPlan(deps, OWNER, { asset: 'USDC', amount: '3' }, same))).toBe('CONFLICT');
  });

  it('keeps each deposit private to its owner', async () => {
    const { deps } = fixture();
    const plan = await createPlan(deps, OWNER, { asset: 'USDC', amount: '1' }, key());
    expect(await code(readPlan(deps, 'mallory.near', plan.id))).toBe('NOT_FOUND');
    expect(await code(approvePlan(deps, 'mallory.near', plan.id, { digest: plan.digest }))).toBe('NOT_FOUND');
  });

  it('binds a hash only once the chain shows it is this deposit', async () => {
    const { deps, world } = fixture();
    const plan = await createPlan(deps, OWNER, { asset: 'USDC', amount: REAL_AMOUNT }, key());
    await approvePlan(deps, OWNER, plan.id, { digest: plan.digest });

    // Not on chain yet: nothing changes, so the wallet's hash can be sent again later.
    world.transactions = new Map();
    const waiting = await submitPlan(deps, OWNER, plan.id, REAL_TX);
    expect(waiting).toMatchObject({ status: 'awaiting_signature', txHash: null, verification: 'pending' });

    // Some other transaction: refused and not recorded.
    const other = '9Wq3xGhQdA4kPjv3bJcYb6S2tFxw8zQm1nC5rT7uLk2E';
    world.transactions = new Map([[other, { ...supplyTx, transaction: { ...supplyTx.transaction, hash: other } }]]);
    const wrongAmount = await createPlan(deps, OWNER, { asset: 'USDC', amount: '5' }, key());
    await approvePlan(deps, OWNER, wrongAmount.id, { digest: wrongAmount.digest });
    expect(await code(submitPlan(deps, OWNER, wrongAmount.id, other))).toBe('INVALID_REQUEST');
    expect((await readPlan(deps, OWNER, wrongAmount.id)).txHash).toBeNull();
    expect(await code(submitPlan(deps, OWNER, plan.id, 'not-a-hash'))).toBe('INVALID_REQUEST');
  });

  it('records a transaction against one deposit only', async () => {
    const { deps } = fixture();
    const first = await createPlan(deps, OWNER, { asset: 'USDC', amount: REAL_AMOUNT }, key());
    const second = await createPlan(deps, OWNER, { asset: 'USDC', amount: REAL_AMOUNT }, key());
    for (const plan of [first, second]) await approvePlan(deps, OWNER, plan.id, { digest: plan.digest });
    await submitPlan(deps, OWNER, first.id, REAL_TX);
    expect(await code(submitPlan(deps, OWNER, second.id, REAL_TX))).toBe('CONFLICT');
  });

  it('refuses a transaction older than the deposit', async () => {
    const { deps, world } = fixture();
    const plan = await createPlan(deps, OWNER, { asset: 'USDC', amount: REAL_AMOUNT }, key());
    await approvePlan(deps, OWNER, plan.id, { digest: plan.digest });
    world.blockMs = START_MS - 60 * 60_000;
    expect(await code(submitPlan(deps, OWNER, plan.id, REAL_TX))).toBe('INVALID_REQUEST');
  });

  it('settles a transfer Rhea handed back as refunded, not confirmed', async () => {
    const { deps, world } = fixture();
    world.transactions = new Map([[REAL_TX, { ...supplyTx, status: { SuccessValue: btoa('"0"') } }]]);
    const plan = await createPlan(deps, OWNER, { asset: 'USDC', amount: REAL_AMOUNT }, key());
    await approvePlan(deps, OWNER, plan.id, { digest: plan.digest });
    expect((await submitPlan(deps, OWNER, plan.id, REAL_TX)).status).toBe('refunded');
  });

  it('cancels only a deposit still in review', async () => {
    const { deps } = fixture();
    const reviewing = await createPlan(deps, OWNER, { asset: 'USDC', amount: '1' }, key());
    expect((await cancelPlan(deps, OWNER, reviewing.id)).status).toBe('cancelled');
    expect(await code(approvePlan(deps, OWNER, reviewing.id, { digest: reviewing.digest }))).toBe('CONFLICT');
    const signing = await createPlan(deps, OWNER, { asset: 'USDC', amount: '1' }, key());
    await approvePlan(deps, OWNER, signing.id, { digest: signing.digest });
    expect(await code(cancelPlan(deps, OWNER, signing.id))).toBe('CONFLICT');
  });

  it('offers the one-time registration to an account Rhea has not seen', async () => {
    const { deps, world } = fixture();
    world.registered = false;
    const account = await readAccount(deps, OWNER, 'USDC');
    expect(account).toMatchObject({ registered: false, balanceRaw: '100000000', executionEnabled: true });
    expect(account.registration?.call.actions[0].params).toMatchObject({
      methodName: 'storage_deposit',
      deposit: '100000000000000000000000',
    });
  });
});

describe('Rhea routes', () => {
  it('need a session for anything about an account or a deposit', async () => {
    for (const [method, path] of [
      ['GET', '/api/lending/rhea/account?asset=USDC'],
      ['POST', '/api/lending/rhea/plans'],
      ['GET', `/api/lending/rhea/plans/${crypto.randomUUID()}`],
    ] as const) {
      const response = await createApp().request(path, { method }, env);
      expect(response.status).toBe(401);
    }
  });
});
