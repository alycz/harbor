import { z } from 'zod';

import { NetworkSchema } from './network.ts';

const RAW_AMOUNT = /^(0|[1-9]\d*)$/;
const NEP141_ASSET = /^nep141:([a-z\d][a-z\d._-]*)$/;
const NEP245_ASSET = /^nep245:([a-z\d][a-z\d._-]*):(\S+)$/;

/** A 1Click asset ID: an opaque provider identifier, never a ticker. */
export const OneClickAssetIdSchema = z
  .string()
  .min(3)
  .max(320)
  .regex(/^nep(141|245):\S+$/, 'Use a 1Click asset ID such as nep141:wrap.near.');

/** The token standard and contract behind a 1Click asset ID, or null if it is not one. */
export function parseOneClickAssetId(
  assetId: string,
): { standard: 'nep141'; contractId: string } | { standard: 'nep245'; contractId: string; tokenId: string } | null {
  const fungible = NEP141_ASSET.exec(assetId);
  if (fungible?.[1]) return { standard: 'nep141', contractId: fungible[1] };
  const multi = NEP245_ASSET.exec(assetId);
  if (multi?.[1] && multi[2]) return { standard: 'nep245', contractId: multi[1], tokenId: multi[2] };
  return null;
}

/**
 * An asset's identity as resolved from a verified registry, never from a ticker alone.
 * `canonicalId` is the venue identifier the registry verified. `symbol` is unique per network, so a
 * bridged asset carries its chain (`USDC.arb`); `chain` is the venue's code for where it lives.
 */
export const AssetRefSchema = z.strictObject({
  network: NetworkSchema,
  canonicalId: z.string().min(1).max(320),
  symbol: z.string().regex(/^[A-Za-z0-9.$-]{1,16}$/),
  name: z.string().min(1).max(64),
  chain: z.string().regex(/^[a-z][a-z0-9]{1,15}$/),
  decimals: z.int().min(0).max(38),
});

export const AmountSchema = z.strictObject({
  asset: AssetRefSchema,
  amountRaw: z.string().regex(RAW_AMOUNT),
});

export type AssetRef = z.infer<typeof AssetRefSchema>;
export type Amount = z.infer<typeof AmountSchema>;
