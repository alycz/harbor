import { z } from 'zod';

const Amount = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,38})$/)
  .refine((value) => BigInt(value) < 2n ** 128n);

/** Read-only preview parity; the contract must still recheck all limits when executing. */
export function fitsLeashPreview(
  q: Record<string, unknown>,
  owner: string,
  vault: {
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
) {
  const amount = Amount.safeParse(q.amountIn);
  const deadline = typeof q.deadline === 'string' ? Date.parse(q.deadline) : NaN;
  return !(
    !amount.success ||
    BigInt(amount.data) === 0n ||
    q.amount !== amount.data ||
    q.dry !== false ||
    q.swapType !== 'EXACT_INPUT' ||
    q.depositType !== 'ORIGIN_CHAIN' ||
    q.refundType !== 'ORIGIN_CHAIN' ||
    q.recipientType !== 'DESTINATION_CHAIN' ||
    q.originAsset !== `nep141:${vault.limits.token}` ||
    q.refundTo !== owner ||
    typeof q.destinationAsset !== 'string' ||
    !vault.limits.buy_assets.includes(q.destinationAsset) ||
    typeof q.recipient !== 'string' ||
    !vault.limits.recipients.includes(q.recipient) ||
    typeof q.depositAddress !== 'string' ||
    !/^[a-f0-9]{64}$/.test(q.depositAddress) ||
    typeof q.slippageTolerance !== 'number' ||
    !Number.isInteger(q.slippageTolerance) ||
    q.slippageTolerance < 0 ||
    q.slippageTolerance > vault.limits.max_slippage_bps ||
    !Number.isFinite(deadline) ||
    deadline <= Date.now() ||
    vault.limits.expires_at_ms <= Date.now() ||
    BigInt(amount.data) > BigInt(vault.balance) ||
    BigInt(amount.data) > BigInt(vault.limits.per_action) ||
    BigInt(amount.data) + BigInt(vault.spent_today) > BigInt(vault.limits.per_day)
  );
}
