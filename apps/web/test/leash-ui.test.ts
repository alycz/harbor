import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import {
  allowanceSentence,
  canSubmitLeash,
  expiryAfterDays,
  fromAtomic,
  requireLeashAmount,
  spokenList,
  toAtomic,
} from '../src/lib/leash-ui.ts';

test('atomic amounts preserve full integer precision', () => {
  const value = '99999999999999999999999999';
  assert.equal(requireLeashAmount(value, true), value);
  assert.equal(requireLeashAmount('0'), '0');
});
test('reject invalid, rounded and overflowing owner amounts', () => {
  for (const value of ['1.2', '1e24', '-1', '01', '', ' 1', (2n ** 128n).toString()]) {
    assert.throws(() => requireLeashAmount(value));
  }
  assert.throws(() => requireLeashAmount('0', true));
});
test('submit requires explicit unattempted approval and enabled runtime', () => {
  assert.equal(canSubmitLeash(true, false, false, 'approved-not-submitted'), true);
  for (const state of ['recovery-required', 'outcome-unknown', 'submitted', 'delivery-verified', undefined]) {
    assert.equal(canSubmitLeash(true, false, false, state), false);
  }
  assert.equal(canSubmitLeash(false, false, false, 'approved-not-submitted'), false);
  assert.equal(canSubmitLeash(true, true, false, 'approved-not-submitted'), false);
  assert.equal(canSubmitLeash(true, false, true, 'approved-not-submitted'), false);
});

describe('token units', () => {
  it('converts decimal amounts to atomic units exactly, and back', () => {
    assert.equal(toAtomic('25', 6), '25000000');
    assert.equal(toAtomic('1.5', 6), '1500000');
    assert.equal(toAtomic('0.000001', 6), '1');
    assert.equal(toAtomic('0.1', 24), '100000000000000000000000');
    assert.equal(fromAtomic('25000000', 6), '25');
    assert.equal(fromAtomic('1500000', 6), '1.5');
    assert.equal(fromAtomic('1', 6), '0.000001');
    assert.equal(fromAtomic('0', 6), '0');
  });

  it('refuses amounts the token cannot hold', () => {
    assert.throws(() => toAtomic('1.0000001', 6), /6 decimals/);
    assert.throws(() => toAtomic('-1', 6));
    assert.throws(() => toAtomic('1e6', 6));
    assert.throws(() => toAtomic('', 6));
  });
});

describe('plain-language allowance', () => {
  const endsAt = new Date(2026, 10, 21);

  it('reads the default vault as one sentence', () => {
    const sentence = allowanceSentence({
      daily: '2',
      perTrade: '2',
      symbol: 'USDC',
      buys: ['NEAR'],
      toOwnAccount: true,
      recipients: 1,
      endsAt,
    });
    assert.match(
      sentence,
      /^Harbor's agent may spend up to 2 USDC a day, only to buy NEAR for your own account, until /,
    );
  });

  it('mentions a per-trade cap only when it differs from the daily budget', () => {
    const sentence = allowanceSentence({
      daily: '10',
      perTrade: '2',
      symbol: 'USDC',
      buys: ['NEAR', 'USDT', 'ETH'],
      toOwnAccount: false,
      recipients: 2,
      endsAt,
    });
    assert.match(
      sentence,
      /up to 10 USDC a day, at most 2 per trade, only to buy NEAR, USDT and ETH for your 2 chosen addresses/,
    );
  });

  it('counts days from now', () => {
    assert.equal(expiryAfterDays(7, 0), 7 * 86_400_000);
    assert.equal(spokenList(['NEAR', 'USDT']), 'NEAR and USDT');
  });
});
