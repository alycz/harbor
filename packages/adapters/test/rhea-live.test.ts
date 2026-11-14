import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { checkSupplyReceipt, createRheaReader } from '../src/rhea/lending.ts';

const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const RPC = 'https://rpc.mainnet.fastnear.com';

// Opt-in, read-only against NEAR mainnet: HARBOR_LIVE_RHEA=1 pnpm --filter @harbor/adapters test
describe.skipIf(env.HARBOR_LIVE_RHEA !== '1')('Rhea live', () => {
  const reader = createRheaReader(RPC);

  it('reads the USDC and USDT markets as open for supply', async () => {
    for (const token of [USDC, 'usdt.tether-token.near']) {
      const market = await reader.market(token);
      expect(market.canDeposit).toBe(true);
      expect(market.extraDecimals).toBe(12);
      expect(market.supplyAprPct).toBeGreaterThan(0);
    }
  });

  it('asks 0.1 NEAR to register, and knows an unused account is not registered', async () => {
    expect(await reader.registrationDeposit()).toBe(10n ** 23n);
    expect(await reader.registered('harbor-unregistered-check.near')).toBe(false);
  });

  it('confirms a real supply read straight from the chain', async () => {
    const accountId = '12fcdd4683f9cbf36a008f619cf36b56eed5058887125b0355b4fc2d4e714cd1';
    const txHash = 'CX3nCVEtyTH7k3fhn3NruvYJmb6XXVDMyw4YMHU1dKNh';
    const result = await reader.transaction(txHash, accountId);
    expect(
      checkSupplyReceipt(result, { txHash, accountId, tokenId: USDC, amountRaw: 11_171_634n, extraDecimals: 12 }),
    ).toBe('confirmed');
    expect(
      await reader.blockTimestampMs(
        (result as { transaction_outcome: { block_hash: string } }).transaction_outcome.block_hash,
      ),
    ).toBeGreaterThan(Date.parse('2026-11-01'));
  });
});
