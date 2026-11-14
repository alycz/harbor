/** Typed calls to Harbor's Rhea Lend endpoints: live rates, the owner's account, and supply plans. */
import { call } from './execution.ts';
import type { WalletTransaction } from './wallet.tsx';

/** The NEAR tokens Harbor supplies to Rhea; the server checks each against its verified registry. */
export const RHEA_SYMBOLS = ['USDC', 'USDT'] as const;
export type RheaSymbol = (typeof RHEA_SYMBOLS)[number];

interface RheaMarket {
  symbol: string;
  assetId: string;
  tokenId: string;
  decimals: number;
  canDeposit: boolean;
  /** The live supply APR from the contract, as a percentage. */
  supplyAprPct: number | null;
  remainingCapRaw: string | null;
}

/** Live figures for everything Harbor deposits into, read by the server when asked. */
export interface LiveEarn {
  fetchedAt: string;
  rhea: { assetId: string; symbol: string; tokenId: string; supplyAprPct: number; supplied: number }[];
  vaults: { receipt: string; apyPct: number; tvlUsd: number; source: { name: string; url: string } }[];
}

export interface RheaAccount {
  market: RheaMarket;
  balanceRaw: string;
  suppliedRaw: string;
  registered: boolean;
  registration: { depositYocto: string; call: WalletTransaction } | null;
  executionEnabled: boolean;
}

type SupplyStatus =
  | 'awaiting_review'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirmed'
  | 'refunded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface SupplyPlan {
  id: string;
  status: SupplyStatus;
  symbol: string;
  tokenId: string;
  decimals: number;
  amountRaw: string;
  digest: string;
  txHash: string | null;
  explorerUrl: string | null;
  createdAt: string;
  expiresAt: string;
  signing: WalletTransaction | null;
  verification?: 'pending' | 'settled';
}

export const lending = {
  live: () => call<LiveEarn>('/api/markets/live'),
  account: (symbol: string) => call<RheaAccount>(`/api/lending/rhea/account?asset=${encodeURIComponent(symbol)}`),
  create: (input: { asset: string; amount: string }) =>
    call<SupplyPlan>('/api/lending/rhea/plans', {
      method: 'POST',
      body: input,
      headers: { 'idempotency-key': crypto.randomUUID() },
    }),
  read: (id: string) => call<SupplyPlan>(`/api/lending/rhea/plans/${id}`),
  approve: (plan: SupplyPlan) =>
    call<SupplyPlan>(`/api/lending/rhea/plans/${plan.id}/approve`, { method: 'POST', body: { digest: plan.digest } }),
  submit: (id: string, txHash: string) =>
    call<SupplyPlan>(`/api/lending/rhea/plans/${id}/submit`, { method: 'POST', body: { txHash } }),
  cancel: (id: string) => call<SupplyPlan>(`/api/lending/rhea/plans/${id}/cancel`, { method: 'POST' }),
};

/** A raw token amount as a plain decimal string, without rounding. */
export function fromRaw(raw: string, decimals: number): string {
  const digits = raw.replace(/^0+(?=\d)/, '').padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** NEAR amounts in yoctoNEAR, for the one-time registration deposit. */
export function fromYocto(yocto: string): string {
  return fromRaw(yocto, 24);
}
