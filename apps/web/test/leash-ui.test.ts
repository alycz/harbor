import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import { canSubmitLeash, fromAtomic, requireLeashAmount, toAtomic } from '../src/lib/leash-ui.ts';

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
