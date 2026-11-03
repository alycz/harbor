import { amountDraftIssue } from './draft-validation.ts';

const SYMBOL = /^[A-Za-z0-9.$-]{1,16}$/;

/** The swap request for a complete draft, or null while the pair or amount is incomplete. */
export function swapDraftRequest(
  sell: string,
  buy: string,
  amount: string,
): { sellAsset: string; buyAsset: string; sellAmount: string } | null {
  if (!SYMBOL.test(sell) || !SYMBOL.test(buy) || sell === buy || amountDraftIssue(amount.trim(), true) !== null) {
    return null;
  }
  return { sellAsset: sell, buyAsset: buy, sellAmount: amount.trim() };
}
