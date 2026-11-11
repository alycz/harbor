/** Typed calls to the owner's strategies and the actions the agent queued under their policy. */
import { call, type Intent } from './execution.ts';

interface Strategy {
  id: string;
  kind: 'dca';
  status: 'active' | 'paused';
  sell: string;
  buy: string;
  amount: string;
  everyHours: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export interface QueuedAction {
  id: string;
  queuedAt: string;
  reason: string;
  intent: Intent;
}

type Strategies = { strategies: Strategy[] };

export const autopilot = {
  strategies: () => call<Strategies>('/api/autopilot/strategies'),
  create: (input: { sell: string; buy: string; amount: string; everyHours: number }) =>
    call<Strategies>('/api/autopilot/strategies', { method: 'POST', body: input }),
  pause: (id: string) => call<Strategies>(`/api/autopilot/strategies/${id}/pause`, { method: 'POST', body: {} }),
  resume: (id: string) => call<Strategies>(`/api/autopilot/strategies/${id}/resume`, { method: 'POST', body: {} }),
  remove: (id: string) => call<Strategies>(`/api/autopilot/strategies/${id}`, { method: 'DELETE' }),
  queue: () => call<{ queue: QueuedAction[] }>('/api/autopilot/queue'),
  dismiss: (id: string) =>
    call<{ queue: QueuedAction[] }>(`/api/autopilot/queue/${id}/dismiss`, { method: 'POST', body: {} }),
};
