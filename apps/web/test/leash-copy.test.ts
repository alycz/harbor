import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Leash describes owner-approved dispatch rather than automatic monitor trading', () => {
  const source = readFileSync(new URL('../src/components/leash-vault.tsx', import.meta.url), 'utf8');
  assert.match(source, /Monitoring ticks do not automatically trade/);
  assert.match(source, /swaps you explicitly approve and submit/);
  assert.doesNotMatch(source, /can act on your monitors without asking/);
  assert.doesNotMatch(source, /contract isn't deployed for this server/);
});
