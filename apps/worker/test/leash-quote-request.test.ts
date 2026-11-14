import { describe, expect, it } from 'vitest';
import { leashQuoteRequest } from '../src/leash/quote-request.ts';

const now = 1800000000000;
const vault = {
  frozen: false,
  balance: '100',
  spent_today: '90',
  limits: {
    token: 'usdc.near',
    per_action: '10',
    per_day: '100',
    buy_assets: ['nep141:usdt.near'],
    recipients: ['alice.near'],
    max_slippage_bps: 100,
    expires_at_ms: now + 60000,
  },
};
const input = { destinationAsset: 'nep141:usdt.near', recipient: 'alice.near', amount: '10', slippageBps: 50 };
describe('automatic Leash quote request', () => {
  it('binds origin and refund to current owner vault and bounds expiry', () => {
    expect(leashQuoteRequest(input, 'alice.near', vault, now)).toEqual({
      dry: false,
      swapType: 'EXACT_INPUT',
      originAsset: 'nep141:usdc.near',
      destinationAsset: input.destinationAsset,
      amount: '10',
      slippageTolerance: 50,
      depositType: 'ORIGIN_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      recipientType: 'DESTINATION_CHAIN',
      refundTo: 'alice.near',
      recipient: 'alice.near',
      depositMode: 'SIMPLE',
      deadline: new Date(now + 60000).toISOString(),
    });
  });
  it('rejects caller-supplied refund and origin overrides', () => {
    expect(() => leashQuoteRequest({ ...input, refundTo: 'mallory.near' }, 'alice.near', vault, now)).toThrow();
    expect(() => leashQuoteRequest({ ...input, originAsset: 'nep141:other.near' }, 'alice.near', vault, now)).toThrow();
  });
  it('rejects absent frozen or expired vaults', () => {
    expect(() => leashQuoteRequest(input, 'alice.near', null, now)).toThrow();
    expect(() => leashQuoteRequest(input, 'alice.near', { ...vault, frozen: true }, now)).toThrow();
    expect(() => leashQuoteRequest(input, 'alice.near', vault, now + 60000)).toThrow();
  });
  it('rejects amount overflow and noncanonical atomic amounts', () => {
    for (const amount of ['0', '01', '1.0', '1e4', (2n ** 128n).toString()]) {
      expect(() => leashQuoteRequest({ ...input, amount }, 'alice.near', vault, now)).toThrow();
    }
  });
  it('rejects disallowed destination recipient slippage and cumulative spend', () => {
    for (const patch of [
      { destinationAsset: 'nep141:evil.near' },
      { recipient: 'mallory.near' },
      { slippageBps: 101 },
      { amount: '11' },
    ]) {
      expect(() => leashQuoteRequest({ ...input, ...patch }, 'alice.near', vault, now)).toThrow();
    }
    expect(() => leashQuoteRequest(input, 'alice.near', { ...vault, spent_today: '91' }, now)).toThrow();
    expect(() => leashQuoteRequest(input, 'alice.near', { ...vault, balance: '9' }, now)).toThrow();
  });
});
