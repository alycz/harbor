import { call } from './execution.ts';

/** The pairs a spread monitor can watch: NEAR tokens that both NEAR Intents and Rhea can price. */
export const SPREAD_PAIRS = [
  { base: 'NEAR', quote: 'USDC' },
  { base: 'NEAR', quote: 'USDT' },
  { base: 'USDT', quote: 'USDC' },
] as const;

export type AutomationKind = 'price_alert' | 'spread_alert';
type AutomationStatus = 'draft' | 'active' | 'paused' | 'completed';
export type CheckResult = 'true' | 'false' | 'unknown';

export interface SpreadConfig {
  base: { assetId: string; symbol: string };
  quote: { assetId: string; symbol: string };
  size: string;
  thresholdPct: number;
  cooldownMinutes: number;
  mode: 'once' | 'repeat';
}

interface Leg {
  venue: string;
  sell: { symbol: string; amount: string };
  buy: { symbol: string; amount: string };
}

export interface RoundTrip {
  route: 'intents_then_rhea' | 'rhea_then_intents';
  legs: Leg[];
  returned: string | null;
  edgePct: number | null;
  error: string | null;
}

export interface SpreadEvidence {
  size: { symbol: string; amount: string };
  thresholdPct: number;
  trips: RoundTrip[];
  best: RoundTrip['route'] | null;
}

export interface SpreadCheck {
  evaluatedAt: string;
  result: CheckResult;
  reason: string;
  evidence: SpreadEvidence;
}

export interface Automation {
  id: string;
  kind: AutomationKind;
  name: string;
  status: AutomationStatus;
  revision: number;
  configHash: string;
  config: unknown;
  intervalSeconds: number;
  armed: boolean;
  nextCheckAt: string | null;
  lastEvaluatedAt: string | null;
  lastResult: CheckResult | null;
  lastAlertAt: string | null;
  createdAt: string;
  unacknowledgedAlerts?: number;
}

export interface AutomationAlert {
  id: string;
  summary: string;
  createdAt: string;
  acknowledgedAt: string | null;
  evaluationId: string;
}

export interface AutomationDetail extends Automation {
  evaluations: Array<{
    id: string;
    evaluatedAt: string;
    delayMs: number;
    result: CheckResult;
    reason: string;
    evidence: unknown;
    triggered: boolean;
  }>;
  alerts: AutomationAlert[];
}

export const automations = {
  list: () => call<{ automations: Automation[] }>('/api/automations'),
  read: (id: string) => call<AutomationDetail>(`/api/automations/${id}`),
  previewSpread: (config: SpreadConfig) =>
    call<SpreadCheck>('/api/automations/preview', { method: 'POST', body: { kind: 'spread_alert', config } }),
  create: (kind: AutomationKind, config: unknown, name?: string) =>
    call<Automation>('/api/automations', { method: 'POST', body: { kind, config, ...(name ? { name } : {}) } }),
  activate: (rule: Pick<Automation, 'id' | 'revision' | 'configHash'>) =>
    call<Automation>(`/api/automations/${rule.id}/activate`, {
      method: 'POST',
      body: { revision: rule.revision, configHash: rule.configHash },
    }),
  pause: (id: string) => call<Automation>(`/api/automations/${id}/pause`, { method: 'POST', body: {} }),
  remove: (id: string) => call<{ ok: true }>(`/api/automations/${id}`, { method: 'DELETE' }),
  acknowledge: (alertId: string) =>
    call<{ ok: true }>(`/api/automations/alerts/${alertId}/acknowledge`, { method: 'POST', body: {} }),
};

/** The venue a round trip buys on first, then sells on. */
export function routeVenues(route: RoundTrip['route']): [string, string] {
  return route === 'intents_then_rhea' ? ['NEAR Intents', 'Rhea'] : ['Rhea', 'NEAR Intents'];
}

/** Whether evidence from a check is a spread monitor's, so it can be drawn as round trips. */
export function isSpreadEvidence(value: unknown): value is SpreadEvidence {
  return typeof value === 'object' && value !== null && Array.isArray((value as { trips?: unknown }).trips);
}

export function formatEdge(edge: number | null): string {
  if (edge === null) return '—';
  return `${edge >= 0 ? '+' : ''}${edge.toFixed(2)}%`;
}
