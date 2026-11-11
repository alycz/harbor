/** Typed calls to the owner's signed policy: draft, sign in the wallet, freeze and revoke. */
import { SUGGESTED_POLICY } from '@harbor/policy/policy';

import { call } from './execution.ts';

export interface PolicyDraft {
  assets: string[];
  spend: { asset: string; perAction: string; perDay: string; total: string }[];
  destinations: { chain: string; address: string }[];
  slippageMaxBps: number;
  quoteMaxAgeSeconds: number;
  /** How often the agent may act on its own, in hours; null lets it act once. */
  agentEveryHours: number | null;
  expiresInDays: number;
}

interface SpendUsage {
  asset: string;
  perAction: string;
  perDay: string;
  total: string;
  spentLastDay: string;
  spentTotal: string;
}

export interface SignedPolicyView {
  id: string;
  revision: number;
  status: 'active' | 'frozen' | 'revoked';
  digest: string;
  owner: string;
  signedAt: string | null;
  frozenAt: string | null;
  validFrom: string;
  expiresAt: string;
  assets: string[];
  destinations: { chain: string; address: string }[];
  slippageMaxBps: number;
  quoteMaxAgeSeconds: number;
  agentEveryHours: number | null;
  spend: { asset: string; perAction: string; perDay: string; total: string }[];
  usage: SpendUsage[];
}

interface Drafted {
  id: string;
  revision: number;
  digest: string;
  message: string;
  nonce: string;
  recipient: string;
}

export const policies = {
  current: () => call<{ policy: SignedPolicyView | null }>('/api/policies/current'),
  draft: (draft: PolicyDraft) => call<Drafted>('/api/policies', { method: 'POST', body: draft }),
  sign: (id: string, signed: { publicKey: string; signature: string }) =>
    call<{ policy: SignedPolicyView | null }>(`/api/policies/${id}/sign`, { method: 'POST', body: signed }),
  freeze: () => call<{ policy: SignedPolicyView | null }>('/api/policies/current/freeze', { method: 'POST', body: {} }),
  revoke: () => call<{ policy: SignedPolicyView | null }>('/api/policies/current/revoke', { method: 'POST', body: {} }),
};

/** The editor's starting point: the signed policy's own values, or Harbor's suggested ones. */
export function draftFrom(policy: SignedPolicyView | null): PolicyDraft {
  if (policy) {
    const days = Math.max(1, Math.round((Date.parse(policy.expiresAt) - Date.parse(policy.validFrom)) / 86_400_000));
    return {
      assets: policy.assets,
      spend: policy.spend,
      destinations: policy.destinations,
      slippageMaxBps: policy.slippageMaxBps,
      quoteMaxAgeSeconds: policy.quoteMaxAgeSeconds,
      agentEveryHours: policy.agentEveryHours,
      expiresInDays: Math.min(90, days),
    };
  }
  const { values } = SUGGESTED_POLICY;
  return {
    assets: ['NEAR', 'USDC'],
    spend: [{ asset: 'NEAR', perAction: '1', perDay: '2', total: '5' }],
    destinations: [],
    slippageMaxBps: values.slippageMaxBps,
    quoteMaxAgeSeconds: values.quoteMaxAgeSeconds,
    agentEveryHours: values.everyHours,
    expiresInDays: values.expiresInDays,
  };
}
