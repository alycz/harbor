import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatApy, formatTokenAmount, venueName } from '../src/lib/format.ts';

describe('formatTokenAmount', () => {
  it('cuts long fractions instead of rounding, so a minimum is never overstated', () => {
    assert.equal(formatTokenAmount('2.415661430692287488866155'), '2.415661');
    assert.equal(formatTokenAmount('8.1999999'), '8.199999');
  });

  it('groups whole digits and drops trailing zeros', () => {
    assert.equal(formatTokenAmount('12345.500000'), '12,345.5');
    assert.equal(formatTokenAmount('1000'), '1,000');
    assert.equal(formatTokenAmount('0.000000001'), '0');
  });
});

describe('formatApy', () => {
  it('shows a yield without a sign, and a dash when there is none', () => {
    assert.equal(formatApy(11.949), '11.95%');
    assert.equal(formatApy(null), '—');
  });
});

describe('venueName', () => {
  it('names 1Click as NEAR Intents and leaves unknown venues as they are', () => {
    assert.equal(venueName('oneclick'), 'NEAR Intents');
    assert.equal(venueName('other'), 'other');
  });
});
