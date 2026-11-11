/** Typed calls to Harbor's intent → quote → plan → approve endpoints. */

interface AssetAmount {
  symbol: string;
  amount: string;
}

export interface SwapAsset {
  network: 'mainnet' | 'testnet';
  canonicalId: string;
  symbol: string;
  name: string;
  chain: string;
  decimals: number;
}

export interface Intent {
  id: string;
  network: 'mainnet' | 'testnet';
  sell: AssetAmount;
  buy: { symbol: string };
}

export interface Quote {
  id: string;
  venue: string;
  sell: AssetAmount;
  expectedOut: AssetAmount;
  minimumOut: AssetAmount;
  slippageBps: number;
  priceImpactBps: number | null;
  protocols: string[];
  harborFeeBps: number;
  expiresAt: string;
}

type PlanStatus =
  | 'policy_checked'
  | 'blocked'
  | 'awaiting_review'
  | 'awaiting_signature'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'refunded'
  | 'failed'
  | 'expired'
  | 'outcome_unknown';

interface Decision {
  verdict: 'allow' | 'warn' | 'block';
  reasons: { pass: boolean; code: string; detail: string; severity: 'block' | 'warn'; rule: string }[];
}

export interface Plan {
  id: string;
  kind: 'swap';
  status: PlanStatus;
  network: 'mainnet' | 'testnet';
  account: string;
  digest: string;
  /** The plan's own checks: a block here stops it for everyone. */
  policy: Decision;
  /** The owner's signed policy applied to this plan: a block means only the owner can approve it. */
  policyCheck: Decision | null;
  source: 'user' | 'autopilot';
  recipient: { chain: string; address: string } | null;
  validUntil: string | null;
  approvedAt: string | null;
  depositAddress: string | null;
  oneClickStatus: string | null;
  deliveryVerified: boolean;
  txHash: string | null;
  explorerUrl: string | null;
  errorCode: string | null;
  quote: Quote;
}

/** A plan of the account's that reached the network: what left it, where, and how it ended. */
export interface ActivityItem {
  id: string;
  kind: string;
  status: PlanStatus;
  createdAt: string;
  txHash: string | null;
  explorerUrl: string | null;
  errorCode: string | null;
  title: string;
  venue: string;
  sent: AssetAmount[];
}

export class ExecutionRequestError extends Error {
  override name = 'ExecutionRequestError';
  readonly code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<NoInfer<T>> {
  const response = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: { ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }), ...init?.headers },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ExecutionRequestError(error?.message ?? 'The request failed.', error?.code);
  }
  return body as T;
}

export const execution = {
  assets: () => call<{ network: 'mainnet' | 'testnet'; assets: SwapAsset[] }>('/api/assets'),
  intent: (id: string) => call<Intent>(`/api/intents/${id}`),
  createSwap: (input: { sellAsset: string; buyAsset: string; sellAmount: string }) =>
    call<Intent>('/api/intents', { method: 'POST', body: { kind: 'swap', ...input } }),
  /** The signed-in account's activity; the server reads the account from the session. */
  activity: () => call<{ network: 'mainnet' | 'testnet'; items: ActivityItem[] }>('/api/plans'),
  quote: async (intentId: string) =>
    (await call<{ quotes: Quote[] }>(`/api/intents/${intentId}/compare`, { method: 'POST' })).quotes[0],
  plan: (input: { intentId: string; quoteId: string }) =>
    call<Plan>('/api/plans', { method: 'POST', body: input, headers: { 'idempotency-key': crypto.randomUUID() } }),
  approve: (plan: Plan) =>
    call<Plan>(`/api/plans/${plan.id}/approve`, { method: 'POST', body: { digest: plan.digest } }),
  read: (planId: string) => call<Plan>(`/api/plans/${planId}`),
};

/** Plain-language reasons for the stable codes a plan can stop with. */
export function planProblem(plan: Pick<Plan, 'errorCode'>): string | null {
  switch (plan.errorCode) {
    case null:
      return null;
    case 'QUOTE_EXPIRED':
      return 'The quote expired before it was used. Get a new quote.';
    case 'APPROVAL_EXPIRED':
      return 'The approval window closed before signing. Review a fresh quote.';
    case 'MIN_OUTPUT_INVALID':
      return 'The quoted minimum was not valid, so Harbor stopped this.';
    case 'HARBOR_FEE_NOT_ZERO':
      return 'The route carried a Harbor fee, which Harbor never charges, so it stopped this.';
    case 'DESTINATION_NOT_OWN':
      return 'This would deliver to an address that is not yours, so Harbor blocked it. Funds only go to addresses you signed.';
    case 'RECIPIENT_MISSING':
      return 'Add your own address on that chain to your policy, then try again.';
    case 'ORIGIN_NOT_NEAR':
      return 'Harbor sends only from your NEAR account. Choose an asset held on NEAR to sell.';
    default:
      return `Harbor stopped this (${plan.errorCode}).`;
  }
}
