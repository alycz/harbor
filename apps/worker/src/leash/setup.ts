import { type NearChain, registrationTransaction } from '@harbor/near/chain';

/**
 * The one-time token registrations an owner needs before a vault works end to end: on the vault's token,
 * so a refund can reach them, and on each NEAR token the agent may buy, so a delivery can. Each missing
 * one is the wallet transaction that adds it; registered tokens are skipped.
 */
export async function ownerRegistrations(
  chain: Pick<NearChain, 'storageRegistered' | 'storageMinimum'>,
  owner: string,
  tokenContracts: readonly string[],
) {
  const missing: ReturnType<typeof registrationTransaction>[] = [];
  for (const token of new Set(tokenContracts)) {
    if (await chain.storageRegistered(token, owner)) continue;
    missing.push(registrationTransaction(token, owner, await chain.storageMinimum(token)));
  }
  return missing;
}
