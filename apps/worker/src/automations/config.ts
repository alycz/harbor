import { z } from 'zod';
import { RoundtripSchema } from './roundtrip.ts';

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

/**
 * A cross-venue spread monitor on one NEAR pair. Each check prices a round trip of `size` (in the quote
 * asset) both ways: buy the base on NEAR Intents and sell it on Rhea, and the reverse. It alerts when the
 * better round trip returns at least `thresholdPct` more than it started with, after each venue's fees.
 */
export const SpreadAlertConfigSchema = z
  .strictObject({
    base: z.strictObject({ assetId: ASSET_ID, symbol: SYMBOL }),
    quote: z.strictObject({ assetId: ASSET_ID, symbol: SYMBOL }),
    /** How much of the quote asset each round trip starts with. */
    size: DECIMAL,
    /** Alert when the better round trip gains at least this, in percent of `size`. */
    /** 0 alerts on any round trip that ends ahead after venue fees; below 0, when its cost falls under that. */
    thresholdPct: z.number().min(-5, 'Set a profit from −5% to 50%.').max(50, 'Set a profit from −5% to 50%.'),
    cooldownMinutes: z.number().int().min(1).max(1_440),
    mode: z.enum(['once', 'repeat']),
  })
  .refine((config) => config.base.assetId !== config.quote.assetId, { message: 'Choose two different assets.' })
  .refine((config) => Number(config.size) > 0, { message: 'Enter a size above zero.' });

export type SpreadAlertConfig = z.infer<typeof SpreadAlertConfigSchema>;

const AUTOMATION_RULE_KINDS = ['price_alert', 'spread_alert', 'roundtrip_alert'] as const;
type AutomationKind = (typeof AUTOMATION_RULE_KINDS)[number];
type AutomationConfig = PriceAlertConfig | SpreadAlertConfig | RoundtripAlertConfig;

/** Checks run about once a minute: the scheduled handler's cadence. */
export const EVALUATION_INTERVAL_MS = 60_000;

export const RoundtripAlertConfigSchema = RoundtripSchema.extend({
  cooldownMinutes: z.number().int().min(1).max(1_440),
  mode: z.enum(['once', 'repeat']),
})
  .refine((config) => config.sellAssetId !== config.buyAssetId, { message: 'Choose two different assets.' })
  .refine((config) => Number(config.amount) > 0, { message: 'Enter an amount above zero.' });
export type RoundtripAlertConfig = z.infer<typeof RoundtripAlertConfigSchema>;
export type MonitorConfig = AutomationConfig;
export type MonitorKind = AutomationKind;
