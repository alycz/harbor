import type { OneClickQuoteRequest } from '@harbor/adapters/oneclick/client';
import { AppError } from '@harbor/domain/errors';
import { z } from 'zod';

const Input = z.strictObject({
  destinationAsset: z.string().min(1).max(320),
  recipient: z.string().min(1).max(256),
  amount: z
    .string()
    .regex(/^[1-9][0-9]{0,38}$/)
    .refine((v) => BigInt(v) < 2n ** 128n),
  slippageBps: z.number().int().min(0).max(10000),
});
export function leashQuoteRequest(
  input: unknown,
  owner: string,
  vault: null | {
    frozen: boolean;
    balance: string;
    spent_today: string;
    limits: {
      token: string;
      per_action: string;
      per_day: string;
      buy_assets: string[];
      recipients: string[];
      max_slippage_bps: number;
      expires_at_ms: number;
    };
  },
  now = Date.now(),
): OneClickQuoteRequest {
  const parsed = Input.safeParse(input);
  if (!parsed.success)
    throw new AppError('INVALID_REQUEST', 'Choose a destination, recipient, atomic amount and slippage.');
  const value = parsed.data;
  if (
    !vault ||
    vault.frozen ||
    vault.limits.expires_at_ms <= now ||
    !vault.limits.buy_assets.includes(value.destinationAsset) ||
    !vault.limits.recipients.includes(value.recipient) ||
    value.slippageBps > vault.limits.max_slippage_bps ||
    BigInt(value.amount) > BigInt(vault.balance) ||
    BigInt(value.amount) > BigInt(vault.limits.per_action) ||
    BigInt(value.amount) + BigInt(vault.spent_today) > BigInt(vault.limits.per_day)
  ) {
    throw new AppError('FORBIDDEN', 'Requested quote does not fit the current vault limits.');
  }
  return {
    dry: false,
    swapType: 'EXACT_INPUT',
    originAsset: `nep141:${vault.limits.token}`,
    destinationAsset: value.destinationAsset,
    amount: value.amount,
    slippageTolerance: value.slippageBps,
    depositType: 'ORIGIN_CHAIN',
    refundType: 'ORIGIN_CHAIN',
    recipientType: 'DESTINATION_CHAIN',
    refundTo: owner,
    recipient: value.recipient,
    depositMode: 'SIMPLE',
    deadline: new Date(Math.min(now + 5 * 60_000, vault.limits.expires_at_ms)).toISOString(),
  };
}
