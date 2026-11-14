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

/** An executable quote: a fresh deposit address that settles to the owner's own recipient and refund address. */
export interface DepositQuote extends VenueQuote {
  deposit: {
    /** Chain on which the owner must fund this deposit. */
    originChain?: string;
    address: string;
    memo: string | null;
    /** After this the provider refunds instead of swapping. */
    deadlineMs: number;
    quoteHash: string;
    correlationId: string;
  };
}

/** What the provider says became of a deposit. Its word alone never settles a plan. */
export interface SettlementReport {
  status:
    | 'PENDING_DEPOSIT'
    | 'KNOWN_DEPOSIT_TX'
    | 'PROCESSING'
    | 'SUCCESS'
    | 'INCOMPLETE_DEPOSIT'
    | 'REFUNDED'
    | 'FAILED';
  amountOut: bigint | null;
  refundedAmount: bigint | null;
  refundReason: string | null;
  deliveryTxHashes: string[];
  updatedAt: string;
}

/**
 * Executing a swap with a venue: an executable quote for the owner's own addresses, notice of the
 * deposit the owner signed, and the provider's report. The venue never signs or moves anything.
 */
export interface SwapExecutor {
  id: SwapVenueId;
  executableQuote(request: {
    network: Network;
    sell: AssetRef;
    buy: AssetRef;
    amountIn: bigint;
    slippageBps: number;
    refundTo: string;
    recipient: string;
  }): Promise<DepositQuote>;
  submitDeposit(input: { txHash: string; depositAddress: string; memo: string | null; sender: string }): Promise<void>;
  status(input: { depositAddress: string; memo: string | null; quoteHash: string }): Promise<SettlementReport>;
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
