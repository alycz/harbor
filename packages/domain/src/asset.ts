import { z } from 'zod';

import { NetworkSchema } from './network.ts';

const RAW_AMOUNT = /^(0|[1-9]\d*)$/;

/**
 * An asset's identity as resolved from a verified registry, never from a ticker alone.
 * `canonicalId` is the venue-independent identifier the registry verified.
 */
export const AssetRefSchema = z.strictObject({
  network: NetworkSchema,
  canonicalId: z.string().min(1).max(320),
  symbol: z.string().min(1).max(32),
  decimals: z.int().min(0).max(38),
});

export const AmountSchema = z.strictObject({
  asset: AssetRefSchema,
  amountRaw: z.string().regex(RAW_AMOUNT),
});

export type AssetRef = z.infer<typeof AssetRefSchema>;
export type Amount = z.infer<typeof AmountSchema>;
