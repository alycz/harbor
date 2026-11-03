import { z } from 'zod';

const BPS = z.int().min(0).max(10_000);
const RAW_AMOUNT = z.string().regex(/^(0|[1-9]\d*)$/);
const ASSET_ID = z.string().min(1).max(320);
const ADDRESS = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[\x21-\x7e]+$/, 'must contain only visible ASCII characters');
const DATE_TIME = z.iso.datetime({ offset: true });

const AmountCapSchema = z.strictObject({
  assetId: ASSET_ID,
  maxRaw: RAW_AMOUNT,
});

/** Where funds may be delivered: only addresses the user named as their own. */
const DestinationSchema = z.strictObject({
  chain: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  address: ADDRESS,
});

const ScheduleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('once') }),
  z.strictObject({
    kind: z.literal('interval'),
    everySeconds: z
      .int()
      .min(60)
      .max(31 * 24 * 3_600),
  }),
]);

/**
 * The limits a user signs for one strategy. Anything outside them comes back to the user for
 * approval. Missing optional caps are disabled, never zero; chain and venue requirements still
 * apply on top of whatever is signed here.
 */
export const PolicySchema = z
  .strictObject({
    version: z.literal('harbor.policy.v1'),
    network: z.enum(['mainnet', 'testnet']),
    owner: ADDRESS,
    allowedAssets: z.array(ASSET_ID).min(1).max(32),
    destinations: z.array(DestinationSchema).min(1).max(16),
    budget: AmountCapSchema,
    perActionCap: AmountCapSchema.nullable(),
    dailyCap: AmountCapSchema.nullable(),
    slippageBps: BPS,
    priceImpactWarningBps: BPS.nullable(),
    quoteMaxAgeSeconds: z.int().min(1).max(3_600),
    schedule: ScheduleSchema,
    validFrom: DATE_TIME,
    expiresAt: DATE_TIME,
  })
  .superRefine((policy, context) => {
    if (Date.parse(policy.expiresAt) <= Date.parse(policy.validFrom)) {
      context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'a policy must expire after it starts' });
    }
    if (new Set(policy.allowedAssets).size !== policy.allowedAssets.length) {
      context.addIssue({ code: 'custom', path: ['allowedAssets'], message: 'allowed assets must be unique' });
    }
    for (const [field, cap] of [
      ['budget', policy.budget],
      ['perActionCap', policy.perActionCap],
      ['dailyCap', policy.dailyCap],
    ] as const) {
      if (cap && !policy.allowedAssets.includes(cap.assetId)) {
        context.addIssue({ code: 'custom', path: [field, 'assetId'], message: 'caps must name an allowed asset' });
      }
    }
  });

export type Policy = z.infer<typeof PolicySchema>;

/**
 * Proposed starting values. They are shown as "Suggested · not yet signed" and only take effect
 * once the user signs a policy with them; nothing applies them on load.
 */
export const SUGGESTED_POLICY = {
  status: 'suggested',
  values: {
    slippageBps: 50,
    priceImpactWarningBps: 100,
    quoteMaxAgeSeconds: 30,
    expiresInDays: 7,
  },
} as const;
