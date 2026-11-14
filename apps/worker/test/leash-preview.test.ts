import { describe, expect, it } from 'vitest';
import { fitsLeashPreview } from '../src/leash/preview-policy.ts';

function preview(spent: string, recipientType = 'DESTINATION_CHAIN') {
  const owner = 'owner.near';
  return fitsLeashPreview(
    {
      amountIn: '10',
      amount: '10',
      dry: false,
      swapType: 'EXACT_INPUT',
      depositType: 'ORIGIN_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      recipientType,
      originAsset: 'nep141:usdc.near',
      destinationAsset: 'nep141:usdt.near',
      refundTo: owner,
      recipient: owner,
      depositAddress: 'a'.repeat(64),
      slippageTolerance: 50,
      deadline: new Date(Date.now() + 60000).toISOString(),
    },
    owner,
    {
      balance: '100',
      spent_today: spent,
      limits: {
        token: 'usdc.near',
        per_action: '10',
        per_day: '100',
        buy_assets: ['nep141:usdt.near'],
        recipients: [owner],
        max_slippage_bps: 100,
        expires_at_ms: Date.now() + 60000,
      },
    },
  );
}
describe('Leash preview mirrors contract limits', () => {
  it('rejects cumulative spend exceeding daily cap', () => expect(preview('91')).toBe(false));
  it('allows exactly remaining daily budget', () => expect(preview('90')).toBe(true));
  it('rejects intents-ledger recipient despite matching text', () => expect(preview('0', 'INTENTS')).toBe(false));
});
