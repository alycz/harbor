import { describe, expect, it } from 'vitest';

import { accountKind, isNearAccountId, isOnNetwork, NearAccountIdSchema } from '../src/account.ts';
import { NEAR_NETWORK_INFO, txExplorerUrl } from '../src/near.ts';

const IMPLICIT = 'a'.repeat(64);
const ETH_IMPLICIT = `0x${'b'.repeat(40)}`;

describe('isNearAccountId', () => {
  it.each(['alice.near', 'a-b_c.sub.near', 'near', 'ab', IMPLICIT, ETH_IMPLICIT, 'alice.testnet'])(
    'accepts %s',
    (id) => {
      expect(isNearAccountId(id)).toBe(true);
    },
  );

  it.each([
    '',
    'a',
    'Alice.near',
    'alice..near',
    '.alice',
    'alice.',
    '-alice.near',
    'alice-.near',
    'al ice.near',
    'a'.repeat(65),
  ])('rejects %j', (id) => {
    expect(isNearAccountId(id)).toBe(false);
    expect(NearAccountIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('accountKind', () => {
  it('tells named accounts from implicit ones', () => {
    expect(accountKind('alice.near')).toBe('named');
    expect(accountKind(IMPLICIT)).toBe('implicit');
    expect(accountKind(ETH_IMPLICIT)).toBe('eth-implicit');
  });
});

describe('isOnNetwork', () => {
  it('refuses an account that names the other network', () => {
    expect(isOnNetwork('alice.near', 'mainnet')).toBe(true);
    expect(isOnNetwork('alice.testnet', 'mainnet')).toBe(false);
    expect(isOnNetwork('alice.testnet', 'testnet')).toBe(true);
    expect(isOnNetwork('alice.near', 'testnet')).toBe(false);
  });

  it('cannot rule out implicit accounts or other top-level names', () => {
    for (const network of ['mainnet', 'testnet'] as const) {
      expect(isOnNetwork(IMPLICIT, network)).toBe(true);
      expect(isOnNetwork(ETH_IMPLICIT, network)).toBe(true);
      expect(isOnNetwork('aurora', network)).toBe(true);
    }
  });
});

describe('network info', () => {
  it('points each network at its own RPC and explorer', () => {
    expect(NEAR_NETWORK_INFO.mainnet.chainId).toBe('mainnet');
    expect(txExplorerUrl('mainnet', 'abc')).toBe('https://nearblocks.io/txns/abc');
    expect(txExplorerUrl('testnet', 'a/b')).toBe('https://testnet.nearblocks.io/txns/a%2Fb');
  });
});
