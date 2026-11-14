import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { outboundReviewRequest, roundtripDraftValid } from '../src/lib/automation-draft.ts';

describe('automation route draft', () => {
  it('requires distinct exact assets and a positive canonical decimal amount', () => {
    for (const amount of ['', '0', '0.0', '-1', '1e3', '01', '1,000', '1000000000000000000']) {
      assert.equal(roundtripDraftValid('near:a', 'eth:a', amount, '0'), false);
    }
    assert.equal(roundtripDraftValid('near:a', 'near:a', '1', '0'), false);
    assert.equal(roundtripDraftValid('', 'eth:a', '1', '0'), false);
    assert.equal(roundtripDraftValid('near:a', 'eth:a', '0.000000000000000000000001', '10000'), true);
  });
  it('rejects non-integer or out-of-range monitoring thresholds', () => {
    for (const threshold of ['-1', '10001', '1.5', '', 'NaN'])
      assert.equal(roundtripDraftValid('a', 'b', '1', threshold), false);
  });
  it('preserves exact canonical route IDs and amount for owner review, never the reverse leg', () => {
    assert.deepEqual(outboundReviewRequest('near:usdc', 'eth:usdc', '12.123456'), {
      sellAsset: 'near:usdc',
      buyAsset: 'eth:usdc',
      sellAmount: '12.123456',
    });
    assert.throws(() => outboundReviewRequest('a', 'a', '1'));
  });
});
