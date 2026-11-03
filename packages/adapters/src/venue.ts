import type { AssetRef } from '@harbor/domain/asset';
import type { Network } from '@harbor/domain/network';

export type SwapVenueId = 'oneclick';

export interface VenueQuote {
  amountIn: bigint;
  amountOut: bigint;
  /** The least the swap may deliver after slippage; settlement is checked against at least this. */
  minAmountOut: bigint;
  /** Price impact in basis points, or null when the venue does not report one. */
  priceImpactBps: number | null;
  platform: string;
  protocols: string[];
  /** The venue's own quote data, kept unchanged so the plan can be bound to exactly it. */
  raw: Record<string, unknown>;
}

/** A source of swap quotes. Executing a quote is the plan lifecycle's job, never the venue's. */
export interface SwapVenue {
  id: SwapVenueId;
  quote(request: {
    network: Network;
    sell: AssetRef;
    buy: AssetRef;
    amountIn: bigint;
    slippageBps: number;
    /** Where refunds and output go; venues that quote without an account ignore them. */
    refundTo?: string;
    recipient?: string;
  }): Promise<VenueQuote>;
}

/** A venue refusal the user can act on, with a stable code, as opposed to an outage. */
export class VenueRefusal extends Error {
  override name = 'VenueRefusal';
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
