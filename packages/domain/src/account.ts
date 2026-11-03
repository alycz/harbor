import { z } from 'zod';

import type { Network } from './network.ts';

const NAMED_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT_ACCOUNT = /^[a-f\d]{64}$/;
const ETH_IMPLICIT_ACCOUNT = /^0x[a-f\d]{40}$/;
const MIN_LENGTH = 2;
const MAX_LENGTH = 64;

export type AccountKind = 'named' | 'implicit' | 'eth-implicit';

/** Whether a string is a valid NEAR account ID under the protocol's naming rules. */
export function isNearAccountId(value: string): boolean {
  return value.length >= MIN_LENGTH && value.length <= MAX_LENGTH && NAMED_ACCOUNT.test(value);
}

export const NearAccountIdSchema = z.string().refine(isNearAccountId, 'Use a valid NEAR account ID.');

/** Implicit accounts are derived from a key: 64 hex characters, or an Ethereum address for ETH-implicit. */
export function accountKind(account: string): AccountKind {
  if (IMPLICIT_ACCOUNT.test(account)) return 'implicit';
  if (ETH_IMPLICIT_ACCOUNT.test(account)) return 'eth-implicit';
  return 'named';
}

/**
 * False for an account that names the other network, such as `alice.testnet` on mainnet. Implicit
 * accounts and other top-level names exist on both, so they cannot be ruled out from the ID alone.
 */
export function isOnNetwork(account: string, network: Network): boolean {
  const foreignSuffix = network === 'mainnet' ? 'testnet' : 'near';
  return account !== foreignSuffix && !account.endsWith(`.${foreignSuffix}`);
}
