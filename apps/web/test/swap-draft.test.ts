import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { amountDraftIssue } from '../src/lib/draft-validation.ts';
import { swapDraftRequest } from '../src/lib/swap-draft.ts';

describe('swapDraftRequest', () => {
  it('builds a request only for a complete pair and a positive plain amount', () => {
    assert.deepEqual(swapDraftRequest('NEAR', 'USDC', ' 12.5 '), {
      sellAsset: 'NEAR',
      buyAsset: 'USDC',
      sellAmount: '12.5',
    });
    assert.equal(swapDraftRequest('NEAR', 'NEAR', '1'), null);
    assert.equal(swapDraftRequest('NEAR', '', '1'), null);
    assert.equal(swapDraftRequest('NEAR', 'USDC', '0'), null);
    assert.equal(swapDraftRequest('NEAR', 'USDC', '1,000'), null);
    assert.equal(swapDraftRequest('<script>', 'USDC', '1'), null);
  });
});

describe('amountDraftIssue', () => {
  it('explains what is wrong with an amount, or returns null', () => {
    assert.equal(amountDraftIssue('', true), 'Enter an amount.');
    assert.equal(amountDraftIssue(''), null);
    assert.equal(amountDraftIssue('1e3'), 'Use decimal digits without separators.');
    assert.equal(amountDraftIssue('0'), 'Enter an amount greater than zero.');
    assert.equal(amountDraftIssue('0', false, true), null);
    assert.equal(amountDraftIssue('2.5'), null);
  });
});
