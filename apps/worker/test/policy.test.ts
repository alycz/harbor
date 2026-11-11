import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.ts';
import { assetRegistry } from '../src/execution/assets.ts';
import { approvePlan, compareIntent, createPlan } from '../src/execution/lifecycle.ts';
import type { ExecutionDeps } from '../src/execution/store.ts';
import { createSwapIntent } from '../src/execution/swap.ts';
import { sessionCookie } from './session.ts';
import { chainSays, createWallet, FULL_ACCESS, FUNCTION_CALL } from './wallet.ts';

const ORIGIN = 'https://harbor.test';

const DRAFT = {
  assets: ['NEAR', 'USDC'],
  spend: [{ asset: 'NEAR', perAction: '2', perDay: '3', total: '5' }],
  destinations: [{ chain: 'base', address: '0xa11ce00000000000000000000000000000000000' }],
  slippageMaxBps: 50,
  quoteMaxAgeSeconds: 60,
  agentEveryHours: 24,
  expiresInDays: 7,
};

interface Drafted {
  id: string;
  revision: number;
  status: string;
  digest: string;
  message: string;
  nonce: string;
  recipient: string;
}

interface Current {
  policy: null | {
    id: string;
    status: string;
    revision: number;
    usage: { asset: string; spentLastDay: string; spentTotal: string }[];
  };
}

function call(path: string, cookie: string, body?: unknown) {
  return createApp().request(
    `${ORIGIN}/api/policies${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

/** Drafts the policy and signs its exact message with a fresh full-access key. */
async function signedPolicy(account: string, draft: unknown = DRAFT) {
  const cookie = await sessionCookie(account);
  const drafted = await (await call('', cookie, draft)).json<Drafted>();
  const wallet = await createWallet();
  const signature = await wallet.sign(drafted.message, drafted.recipient, drafted.nonce);
  chainSays(FULL_ACCESS);
  const signed = await call(`/${drafted.id}/sign`, cookie, { publicKey: wallet.publicKey, signature });
  vi.restoreAllMocks();
  return { cookie, drafted, signed, wallet, signature };
}

function fixture(): { deps: ExecutionDeps; clock: { now: number } } {
  const clock = { now: Date.now() };
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
          amountOut: 3_000_000n,
          minAmountOut: 2_985_000n,
          priceImpactBps: null,
          platform: 'NEAR Intents',
          protocols: ['NEAR Intents'],
          raw: {},
        }),
      },
      assets: assetRegistry('mainnet'),
      now: () => clock.now,
    },
  };
}

async function plan(
  h: ReturnType<typeof fixture>,
  account: string,
  input: { amount: string; recipient?: string; buy?: string },
) {
  const intent = await createSwapIntent(h.deps, {
    sell: 'NEAR',
    buy: input.buy ?? 'USDC',
    amount: input.amount,
    source: 'chat',
    recipient: input.recipient,
  });
  const [quote] = (await compareIntent(h.deps, intent.id)).quotes;
  if (!quote) throw new Error('no quote');
  return createPlan(h.deps, {
    intentId: intent.id,
    quoteId: quote.id,
    accountId: account,
    idempotencyKey: crypto.randomUUID(),
  });
}

function failed(decision: { reasons: { pass: boolean; code: string }[] } | null) {
  return decision?.reasons.filter((reason) => !reason.pass).map((reason) => reason.code) ?? [];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signing a policy', () => {
  it('shows the limits and the digest, and activates only on a full-access signature of that message', async () => {
    const { drafted, signed } = await signedPolicy('signer.near');
    expect(drafted).toMatchObject({ status: 'pending', revision: 1, recipient: 'harbor.test' });
    expect(drafted.message).toContain('NEAR: up to 2 per action, 3 per day, 5 in total');
    expect(drafted.message).toContain('0xa11ce00000000000000000000000000000000000 (base)');
    expect(drafted.message).toContain(`Policy digest: ${drafted.digest}`);
    expect(signed.status).toBe(200);
    expect((await signed.json<Current>()).policy).toMatchObject({ status: 'active', revision: 1 });
  });

  it('refuses a function-call key, a replayed signature and another account', async () => {
    const cookie = await sessionCookie('careful.near');
    const drafted = await (await call('', cookie, DRAFT)).json<Drafted>();
    const wallet = await createWallet();
    const signature = await wallet.sign(drafted.message, drafted.recipient, drafted.nonce);

    chainSays(FUNCTION_CALL);
    expect((await call(`/${drafted.id}/sign`, cookie, { publicKey: wallet.publicKey, signature })).status).toBe(401);
    vi.restoreAllMocks();

    const mallory = await sessionCookie('mallory.near');
    chainSays(FULL_ACCESS);
    expect((await call(`/${drafted.id}/sign`, mallory, { publicKey: wallet.publicKey, signature })).status).toBe(404);
    expect((await call(`/${drafted.id}/sign`, cookie, { publicKey: wallet.publicKey, signature })).status).toBe(200);
    expect((await call(`/${drafted.id}/sign`, cookie, { publicKey: wallet.publicKey, signature })).status).toBe(409);

    const forged = await wallet.sign(`${drafted.message} and 1000 USDC more`, drafted.recipient, drafted.nonce);
    const second = await (await call('', cookie, DRAFT)).json<Drafted>();
    expect((await call(`/${second.id}/sign`, cookie, { publicKey: wallet.publicKey, signature: forged })).status).toBe(
      401,
    );
  });

  it('rejects addresses that are not valid on their chain and assets the network does not have', async () => {
    const cookie = await sessionCookie('typo.near');
    const badAddress = { ...DRAFT, destinations: [{ chain: 'base', address: 'not-an-address' }] };
    expect((await call('', cookie, badAddress)).status).toBe(400);
    expect((await call('', cookie, { ...DRAFT, assets: ['DOGE'] })).status).toBe(400);
    expect((await call('', '', DRAFT)).status).toBe(401);
  });

  it('freezes at once without a signature, and supersedes the old policy when a new one is signed', async () => {
    const { cookie } = await signedPolicy('freezer.near');
    const frozen = await (await call('/current/freeze', cookie, {})).json<Current>();
    expect(frozen.policy?.status).toBe('frozen');
    expect((await call('/current/freeze', cookie, {})).status).toBe(409);

    const again = await signedPolicy('freezer.near');
    expect((await again.signed.json<Current>()).policy).toMatchObject({ status: 'active', revision: 2 });
    const { results } = await env.DB.prepare(
      "SELECT revision, status FROM policies WHERE owner_account = 'freezer.near' AND status != 'pending' ORDER BY revision",
    ).all<{ revision: number; status: string }>();
    expect(results).toEqual([
      { revision: 1, status: 'superseded' },
      { revision: 2, status: 'active' },
    ]);

    const revoked = await (await call('/current/revoke', again.cookie, {})).json<Current>();
    expect(revoked.policy?.status).toBe('revoked');
  });
});

describe('plans under a signed policy', () => {
  it('asks the owner for everything when no policy is signed', async () => {
    const h = fixture();
    const created = await plan(h, 'nopolicy.near', { amount: '1' });
    expect(created.status).toBe('awaiting_review');
    expect(failed(created.policyCheck)).toEqual(['NO_POLICY']);
  });

  it('lets an in-policy plan through for the agent, and counts approvals against the limits', async () => {
    await signedPolicy('budget.near');
    const h = fixture();
    const first = await plan(h, 'budget.near', { amount: '2' });
    expect(first.policyCheck?.verdict).not.toBe('block');
    expect(first.recipient).toEqual({ chain: 'near', address: 'budget.near' });
    await approvePlan(h.deps, first.id, 'budget.near', { digest: first.digest });

    const second = await plan(h, 'budget.near', { amount: '1.5' });
    expect(failed(second.policyCheck)).toEqual(['DAILY_LIMIT']);
    expect(second.status).toBe('awaiting_review');
    const tooBig = await plan(h, 'budget.near', { amount: '2.5' });
    expect(failed(tooBig.policyCheck)).toEqual(['PER_ACTION_LIMIT', 'DAILY_LIMIT']);
  });

  it('blocks delivery to an address that is not the owner’s, and records an approval request', async () => {
    await signedPolicy('victim.near');
    const h = fixture();
    const poisoned = await plan(h, 'victim.near', { amount: '1', recipient: 'attacker.near' });
    expect(poisoned).toMatchObject({ status: 'blocked', errorCode: 'DESTINATION_NOT_OWN' });
    expect(failed(poisoned.policyCheck)).toContain('DESTINATION_NOT_SIGNED');
    await expect(approvePlan(h.deps, poisoned.id, 'victim.near', { digest: poisoned.digest })).rejects.toThrow(
      'not waiting for review',
    );
    const event = await env.DB.prepare('SELECT reason FROM plan_events WHERE plan_id = ?')
      .bind(poisoned.id)
      .first<{ reason: string }>();
    expect(event?.reason).toContain('DESTINATION_NOT_OWN');

    const signedBase = await plan(h, 'victim.near', { amount: '1', buy: 'USDC.base' });
    expect(signedBase.recipient).toEqual({ chain: 'base', address: '0xa11ce00000000000000000000000000000000000' });
    expect(signedBase.status).toBe('awaiting_review');
  });

  it('stops the agent on a frozen policy, and refuses to deliver cross-chain without a signed address', async () => {
    const { cookie } = await signedPolicy('frozen.near');
    await call('/current/freeze', cookie, {});
    const h = fixture();
    const frozen = await plan(h, 'frozen.near', { amount: '1' });
    expect(failed(frozen.policyCheck)).toEqual(['POLICY_FROZEN']);
    const nowhere = await plan(h, 'frozen.near', { amount: '1', buy: 'USDC.arb' });
    expect(nowhere).toMatchObject({ status: 'blocked', errorCode: 'RECIPIENT_MISSING' });
  });
});
