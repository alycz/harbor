import { describe, expect, it } from 'vitest';

import {
  APPROVAL_DIGEST_DOMAIN,
  type ApprovalBinding,
  ApprovalBindingSchema,
  canonicalApprovalJson,
  computeApprovalDigest,
} from '../src/approval.ts';

const approval: ApprovalBinding = {
  version: 'harbor.near-intents.approval.v1',
  account_id: 'alice.near',
  network: 'near:mainnet',
  idempotency_key: 'attempt-1',
  policy_digest: 'A'.repeat(64),
  quote_id: 'quote-123',
  quote_hash: '3'.repeat(44),
  provider_signature_verified: true,
  origin_asset: 'nep141:wrap.near',
  destination_asset: 'nep141:eth-0xa0b8.omft.near',
  amount_in: '1000000000000000000000000',
  min_amount_out: '2750000',
  recipient: '0x0123456789abcdef',
  refund_to: 'alice.near',
  deposit_address: 'deposit.near',
  approval_expires_at: '2026-11-02T11:58:00.000Z',
  provider_deadline_at: '2026-11-02T12:00:00.000Z',
};

describe('approval digest', () => {
  it('binds every field and deposit memo presence into a stable digest', async () => {
    const digest = await computeApprovalDigest(approval);
    expect(digest).toMatch(/^[A-F0-9]{64}$/);
    const separated = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${APPROVAL_DIGEST_DOMAIN}\0${canonicalApprovalJson(approval)}`),
    );
    expect(digest).toBe(
      Array.from(new Uint8Array(separated), (byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase(),
    );
    expect(await computeApprovalDigest({ ...approval })).toBe(digest);
    expect(await computeApprovalDigest({ ...approval, account_id: 'bob.near' })).not.toBe(digest);
    expect(await computeApprovalDigest({ ...approval, recipient: 'bob.near' })).not.toBe(digest);
    expect(await computeApprovalDigest({ ...approval, deposit_memo: '12345' })).not.toBe(digest);
  });

  it('rejects other versions, unknown fields and an unverified provider signature', () => {
    expect(ApprovalBindingSchema.safeParse({ ...approval, version: 'harbor.near-intents.approval.v0' }).success).toBe(
      false,
    );
    expect(ApprovalBindingSchema.safeParse({ ...approval, extra: true }).success).toBe(false);
    expect(ApprovalBindingSchema.safeParse({ ...approval, provider_signature_verified: false }).success).toBe(false);
  });

  it('expires the approval no later than the provider refund deadline', () => {
    expect(
      ApprovalBindingSchema.safeParse({ ...approval, approval_expires_at: '2026-11-02T12:00:01.000Z' }).success,
    ).toBe(false);
  });

  it('rejects a swap from an asset into itself', () => {
    expect(ApprovalBindingSchema.safeParse({ ...approval, destination_asset: approval.origin_asset }).success).toBe(
      false,
    );
  });
});
