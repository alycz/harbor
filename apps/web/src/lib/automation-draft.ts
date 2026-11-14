/** Validate without floating-point conversion of token amounts. The server resolves canonical IDs. */
export function roundtripDraftValid(origin: string, via: string, amount: string, threshold: string): boolean {
  return Boolean(
    origin &&
      via &&
      origin !== via &&
      /^(0|[1-9]\d{0,17})(\.\d{1,24})?$/.test(amount) &&
      /[1-9]/.test(amount) &&
      /^\d+$/.test(threshold) &&
      Number(threshold) <= 10_000,
  );
}

/** A scanner only prepares the outbound leg; it never promises execution of a round trip. */
export function outboundReviewRequest(origin: string, via: string, amount: string) {
  if (!roundtripDraftValid(origin, via, amount, '0')) throw new Error('Choose a valid route and amount.');
  return { sellAsset: origin, buyAsset: via, sellAmount: amount };
}
