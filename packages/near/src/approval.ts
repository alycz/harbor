import { z } from 'zod';

const SafeIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const ProviderStringSchema = z.string().min(1).max(512).regex(/^\S+$/);
const AtomicAmountSchema = z.string().regex(/^[1-9]\d*$/);
const Sha256DigestSchema = z.string().regex(/^[A-F0-9]{64}$/);
const DateTimeSchema = z.iso.datetime({ offset: true });
const QuoteHashSchema = z
  .string()
  .min(43)
  .max(45)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/);
const AccountIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9._-]+$/);
/** 1Click asset identifiers are opaque provider identifiers, not ticker symbols. */
const AssetIdSchema = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*:\S+$/);

/**
 * Everything a user approves for one 1Click deposit. The digest binds every field, so a quote,
 * recipient, refund address, deposit address or deadline that changes after review cannot reuse
 * the approval.
 */
export const ApprovalBindingSchema = z
  .strictObject({
    version: z.literal('harbor.near-intents.approval.v1'),
    account_id: AccountIdSchema,
    network: z.literal('near:mainnet'),
    idempotency_key: SafeIdentifierSchema,
    policy_digest: Sha256DigestSchema,
    quote_id: SafeIdentifierSchema,
    quote_hash: QuoteHashSchema,
    provider_signature_verified: z.literal(true),
    origin_asset: AssetIdSchema,
    destination_asset: AssetIdSchema,
    amount_in: AtomicAmountSchema,
    min_amount_out: AtomicAmountSchema,
    recipient: ProviderStringSchema,
    refund_to: ProviderStringSchema,
    deposit_address: ProviderStringSchema,
    /** Presence and value are digest-bound when the provider supplies a memo. */
    deposit_memo: ProviderStringSchema.optional(),
    /** Harbor's own approval freshness boundary. */
    approval_expires_at: DateTimeSchema,
    /** 1Click's refund-start deadline from the executable quote. */
    provider_deadline_at: DateTimeSchema,
  })
  .superRefine((binding, context) => {
    if (binding.origin_asset === binding.destination_asset) {
      context.addIssue({
        code: 'custom',
        path: ['destination_asset'],
        message: 'origin and destination assets must differ',
      });
    }
    if (Date.parse(binding.approval_expires_at) > Date.parse(binding.provider_deadline_at)) {
      context.addIssue({
        code: 'custom',
        path: ['approval_expires_at'],
        message: 'approval must expire no later than the provider deadline',
      });
    }
  });
export type ApprovalBinding = z.infer<typeof ApprovalBindingSchema>;

/** Explicit domain separation keeps this digest distinct from other canonical payload hashes. */
export const APPROVAL_DIGEST_DOMAIN = 'harbor.near-intents.approval.v1' as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new Error('canonical JSON rejects unsupported values');
}

export function canonicalApprovalJson(value: ApprovalBinding): string {
  return canonicalJson(ApprovalBindingSchema.parse(value));
}

/** Upper-case hex SHA-256 over the domain tag, a NUL byte and the canonical binding. */
export async function computeApprovalDigest(value: ApprovalBinding): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${APPROVAL_DIGEST_DOMAIN}\0${canonicalApprovalJson(value)}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
