import { describe, expect, it } from 'vitest';

import { type ActionFacts, checkAction, type SignedPolicy } from '../src/check.ts';
import type { Policy } from '../src/policy.ts';

const NEAR = 'nep141:wrap.near';
const USDC = 'nep141:usdc.near';
const NOW = Date.parse('2026-11-06T12:00:00Z');
const HOUR = 60 * 60_000;

const body: Policy = {
  version: 'harbor.policy.v1',
  network: 'mainnet',
  owner: 'alice.near',
  allowedAssets: [NEAR, USDC],
  spend: [{ assetId: NEAR, perActionMaxRaw: '2000', dailyMaxRaw: '3000', totalMaxRaw: '5000' }],
  destinations: [{ chain: 'base', address: '0xa11ce00000000000000000000000000000000000' }],
  slippageMaxBps: 50,
  quoteMaxAgeSeconds: 60,
  schedule: { kind: 'interval', everySeconds: 3_600 },
  validFrom: '2026-11-04T00:00:00Z',
  expiresAt: '2026-11-11T00:00:00Z',
};
const policy: SignedPolicy = { id: 'p1', body, status: 'active', signedAtMs: NOW - 48 * HOUR };

const action: ActionFacts = {
  nowMs: NOW,
  byAgent: true,
  sellAsset: NEAR,
  buyAsset: USDC,
  amountInRaw: 1000n,
  recipient: { chain: 'near', address: 'alice.near' },
  slippageBps: 50,
  quoteObservedAtMs: NOW - 5_000,
  spentLastDayRaw: 0n,
  spentSinceSignedRaw: 0n,
  lastAgentActionMs: null,
};

function failed(decision: ReturnType<typeof checkAction>) {
  return decision.reasons.filter((reason) => !reason.pass).map((reason) => reason.code);
}

describe('checkAction', () => {
  it('lets the agent act inside every signed limit', () => {
    const decision = checkAction(policy, action);
    expect(decision.verdict).toBe('allow');
    expect(failed(decision)).toEqual([]);
  });

  it('sends everything back to the owner when no policy is signed', () => {
    const decision = checkAction(null, action);
    expect(decision.verdict).toBe('block');
    expect(failed(decision)).toEqual(['NO_POLICY']);
  });

  it('blocks a destination the owner did not sign, whoever asks for it', () => {
    const poisoned = checkAction(policy, { ...action, recipient: { chain: 'near', address: 'attacker.near' } });
    expect(poisoned.verdict).toBe('block');
    expect(failed(poisoned)).toEqual(['DESTINATION_NOT_SIGNED']);
    expect(poisoned.reasons.find((reason) => !reason.pass)?.detail).toContain('attacker.near');
    // A signed address on another chain is the owner's; the same address on the wrong chain is not.
    const base = { chain: 'base', address: '0xa11ce00000000000000000000000000000000000' };
    expect(checkAction(policy, { ...action, recipient: base }).verdict).toBe('allow');
    expect(failed(checkAction(policy, { ...action, recipient: { ...base, chain: 'arb' } }))).toEqual([
      'DESTINATION_NOT_SIGNED',
    ]);
  });

  it('holds each spend limit, counting what was already committed', () => {
    expect(failed(checkAction(policy, { ...action, amountInRaw: 2001n }))).toEqual(['PER_ACTION_LIMIT']);
    expect(failed(checkAction(policy, { ...action, spentLastDayRaw: 2500n }))).toEqual(['DAILY_LIMIT']);
    expect(failed(checkAction(policy, { ...action, spentSinceSignedRaw: 4500n }))).toEqual(['BUDGET_EXCEEDED']);
    expect(failed(checkAction(policy, { ...action, sellAsset: USDC, buyAsset: NEAR }))).toEqual([
      'SPEND_NOT_ALLOWED',
      'DAILY_LIMIT',
      'BUDGET_EXCEEDED',
    ]);
  });

  it('stops the agent when frozen, expired, or trading an asset the policy does not allow', () => {
    expect(failed(checkAction({ ...policy, status: 'frozen' }, action))).toEqual(['POLICY_FROZEN']);
    const expiry = Date.parse(body.expiresAt);
    expect(failed(checkAction(policy, { ...action, nowMs: expiry, quoteObservedAtMs: expiry }))).toEqual([
      'POLICY_EXPIRED',
    ]);
    expect(failed(checkAction(policy, { ...action, buyAsset: 'nep141:meme.near' }))).toEqual(['ASSET_NOT_ALLOWED']);
  });

  it('holds slippage, quote age and the agent schedule, but never schedules the owner', () => {
    expect(failed(checkAction(policy, { ...action, slippageBps: 51 }))).toEqual(['SLIPPAGE_ABOVE_POLICY']);
    expect(failed(checkAction(policy, { ...action, quoteObservedAtMs: NOW - 61_000 }))).toEqual(['QUOTE_TOO_OLD']);
    const tooSoon = { ...action, lastAgentActionMs: NOW - HOUR / 2 };
    expect(failed(checkAction(policy, tooSoon))).toEqual(['SCHEDULE_NOT_DUE']);
    expect(checkAction(policy, { ...tooSoon, byAgent: false }).verdict).toBe('allow');
    expect(checkAction(policy, { ...action, lastAgentActionMs: NOW - HOUR }).verdict).toBe('allow');
    const once = { ...policy, body: { ...body, schedule: { kind: 'once' as const } } };
    expect(failed(checkAction(once, { ...action, lastAgentActionMs: NOW - 10 * HOUR }))).toEqual(['SCHEDULE_NOT_DUE']);
  });
});
