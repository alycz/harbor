import { z } from 'zod';

const ASSET_ID = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*:\S+$/, 'Use a venue asset ID such as nep141:wrap.near.');
const SYMBOL = z.string().regex(/^[A-Za-z0-9.$-]{1,16}$/);
const DECIMAL = z.string().regex(/^(0|[1-9]\d{0,17})(\.\d{1,24})?$/, 'Enter a plain decimal amount.');

/** A price alert over one quoted swap. Units are in every field name or carried by the asset. */
export const PriceAlertConfigSchema = z
  .strictObject({
    sell: z.strictObject({ assetId: ASSET_ID, symbol: SYMBOL, amount: DECIMAL }),
    buy: z.strictObject({ assetId: ASSET_ID, symbol: SYMBOL }),
    /** Alert when the quoted output for the sell amount reaches this, in the buy asset. */
    minOutput: DECIMAL,
    /** After an alert, wait at least this long before the next one. */
    cooldownMinutes: z.number().int().min(1).max(1_440),
    /** `once` stops after the first alert; `repeat` re-arms when the price falls back below. */
    mode: z.enum(['once', 'repeat']),
  })
  .refine((config) => config.sell.assetId !== config.buy.assetId, { message: 'Choose two different assets.' })
  .refine((config) => Number(config.sell.amount) > 0, { message: 'Enter an amount above zero.' })
  .refine((config) => Number(config.minOutput) > 0, { message: 'Enter a target above zero.' });

export type PriceAlertConfig = z.infer<typeof PriceAlertConfigSchema>;

/** Checks run about once a minute: the scheduled handler's cadence. */
export const EVALUATION_INTERVAL_MS = 60_000;
