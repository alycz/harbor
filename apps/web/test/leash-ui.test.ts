import assert from 'node:assert/strict';
import test from 'node:test';
import { canSubmitLeash, requireLeashAmount } from '../src/lib/leash-ui.ts';

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
