import { z } from 'zod';

const BPS = z.int().min(0).max(10_000);
const RAW_AMOUNT = z.string().regex(/^(0|[1-9]\d{0,38})$/);
const ASSET_ID = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*:\S+$/, 'must be a venue asset ID such as nep141:wrap.near');
const ADDRESS = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[\x21-\x7e]+$/, 'must contain only visible ASCII characters');
const DATE_TIME = z.iso.datetime({ offset: true });
const MAX_LIFETIME_MS = 90 * 24 * 60 * 60_000;

export const POLICY_VERSION = 'harbor.policy.v1';

/** How much of one asset may leave the owner's account, in that asset's raw units. */
const SpendLimitSchema = z
  .strictObject({
    assetId: ASSET_ID,
    perActionMaxRaw: RAW_AMOUNT,
    dailyMaxRaw: RAW_AMOUNT,
    totalMaxRaw: RAW_AMOUNT,
  })
  .refine((limit) => BigInt(limit.perActionMaxRaw) <= BigInt(limit.totalMaxRaw), {
    message: 'the per-action limit cannot exceed the total',
    path: ['perActionMaxRaw'],
  })
  .refine((limit) => BigInt(limit.dailyMaxRaw) <= BigInt(limit.totalMaxRaw), {
    message: 'the daily limit cannot exceed the total',
    path: ['dailyMaxRaw'],
  });

/** An address of the owner's own, on one chain. Funds may only ever be delivered to these. */
const DestinationSchema = z.strictObject({
  chain: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  address: ADDRESS,
});

/** How often the agent may act on its own: once, or at most once per interval. */
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
 * The limits an owner signs. Within them the agent may act on its own; anything outside them comes
 * back to the owner for approval. Amounts are raw integers in each asset's own units, so no price
 * feed decides whether a limit holds. Chain and venue checks apply on top of whatever is signed here.
 */
export const PolicySchema = z
  .strictObject({
    version: z.literal(POLICY_VERSION),
    network: z.enum(['mainnet', 'testnet']),
    owner: ADDRESS,
    allowedAssets: z.array(ASSET_ID).min(1).max(32),
    spend: z.array(SpendLimitSchema).min(1).max(16),
    destinations: z.array(DestinationSchema).max(16),
    slippageMaxBps: BPS,
    quoteMaxAgeSeconds: z.int().min(1).max(3_600),
    schedule: ScheduleSchema,
    validFrom: DATE_TIME,
    expiresAt: DATE_TIME,
  })
  .superRefine((policy, context) => {
    const starts = Date.parse(policy.validFrom);
    const ends = Date.parse(policy.expiresAt);
    if (ends <= starts) {
      context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'a policy must expire after it starts' });
    }
    if (ends - starts > MAX_LIFETIME_MS) {
      context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'a policy can last at most 90 days' });
    }
    if (new Set(policy.allowedAssets).size !== policy.allowedAssets.length) {
      context.addIssue({ code: 'custom', path: ['allowedAssets'], message: 'allowed assets must be unique' });
    }
    const spent = policy.spend.map((limit) => limit.assetId);
    if (new Set(spent).size !== spent.length) {
      context.addIssue({ code: 'custom', path: ['spend'], message: 'one spend limit per asset' });
    }
    for (const [index, assetId] of spent.entries()) {
      if (!policy.allowedAssets.includes(assetId)) {
        context.addIssue({
          code: 'custom',
          path: ['spend', index],
          message: 'spend limits must name an allowed asset',
        });
      }
    }
    const addresses = policy.destinations.map((destination) => `${destination.chain}:${destination.address}`);
    if (new Set(addresses).size !== addresses.length) {
      context.addIssue({ code: 'custom', path: ['destinations'], message: 'destinations must be unique' });
    }
  });

export type Policy = z.infer<typeof PolicySchema>;
export type Destination = z.infer<typeof DestinationSchema>;
export type SpendLimit = z.infer<typeof SpendLimitSchema>;

/** Every address the owner may receive at: their own NEAR account, plus the destinations they signed. */
export function ownAddresses(policy: Pick<Policy, 'owner' | 'destinations'> | null, owner: string): Destination[] {
  return [{ chain: 'near', address: owner }, ...(policy?.destinations ?? [])];
}

export function isOwnAddress(own: readonly Destination[], destination: Destination): boolean {
  return own.some((entry) => entry.chain === destination.chain && entry.address === destination.address);
}

/** Key-sorted JSON with undefined values left out: the exact bytes the digest covers. */
export function canonicalPolicyJson(policy: Policy): string {
  return canonical(PolicySchema.parse(policy));
}

/** Lower-case hex SHA-256 over the version tag, a NUL byte and the canonical policy. */
export async function policyDigest(policy: Policy): Promise<string> {
  const bytes = new TextEncoder().encode(`${POLICY_VERSION}\0${canonicalPolicyJson(policy)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** What the wallet shows when the owner signs: the limits in words, and the digest that binds them. */
export function policyMessage(
  policy: Policy,
  digest: string,
  revision: number,
  describe: (assetId: string) => { symbol: string; format(raw: string): string },
): string {
  const assets = policy.allowedAssets.map((assetId) => describe(assetId).symbol).join(', ');
  const limits = policy.spend.map((limit) => {
    const asset = describe(limit.assetId);
    return `${asset.symbol}: up to ${asset.format(limit.perActionMaxRaw)} per action, ${asset.format(limit.dailyMaxRaw)} per day, ${asset.format(limit.totalMaxRaw)} in total`;
  });
  const destinations = ownAddresses(policy, policy.owner).map((entry) => `${entry.address} (${entry.chain})`);
  const schedule =
    policy.schedule.kind === 'once' ? 'once' : `at most once every ${formatSeconds(policy.schedule.everySeconds)}`;
  return [
    `Sign Harbor policy #${revision} for ${policy.owner} on NEAR ${policy.network}.`,
    '',
    `Assets: ${assets}`,
    `Spending: ${limits.join('; ')}`,
    `Funds may only go to: ${destinations.join(', ')}`,
    `Slippage at most ${policy.slippageMaxBps / 100}%. The agent may act ${schedule}.`,
    `Valid ${policy.validFrom} to ${policy.expiresAt}.`,
    '',
    `Policy digest: ${digest}`,
    'Signing this moves no funds. You can freeze it at any time.',
  ].join('\n');
}

/**
 * Proposed starting values for the policy editor. They only take effect once the owner signs a
 * policy with them; nothing applies them on load.
 */
export const SUGGESTED_POLICY = {
  status: 'suggested',
  values: {
    slippageMaxBps: 50,
    quoteMaxAgeSeconds: 60,
    expiresInDays: 7,
    everyHours: 24,
  },
} as const;

function formatSeconds(seconds: number): string {
  if (seconds % 86_400 === 0) return seconds === 86_400 ? 'day' : `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return seconds === 3_600 ? 'hour' : `${seconds / 3_600} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('canonical JSON rejects unsupported values');
}
