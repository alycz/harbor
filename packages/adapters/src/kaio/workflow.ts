import { KaioApiError, KaioInvestorClient, type KaioSubscriptionRequest } from './client.ts';

/** Supplied by server-side investor authentication, never by request JSON. */
export interface KaioInvestorSession {
  harborAccount: string;
  investorId: string;
  expiresAtMs: number;
  getAccessToken(): Promise<string>;
}

export interface KaioOrderAttempt {
  id: string;
  harborAccount: string;
  investorId: string;
  instrumentId: string;
  amount: string;
  state: 'submitting' | 'received' | 'rejected' | 'unknown';
  createdAtMs: number;
}

/**
 * Durable, server-owned storage. claim MUST atomically insert-if-absent with a
 * unique (harborAccount, id) constraint and return the stored row on conflict.
 * A process-local map is not sufficient. Do not persist credentials or raw
 * provider responses (which may contain investor personal data).
 */
export interface KaioOrderStore {
  claim(attempt: KaioOrderAttempt): Promise<{ inserted: boolean; attempt: KaioOrderAttempt }>;
  setState(account: string, id: string, state: KaioOrderAttempt['state']): Promise<void>;
}

export interface KaioOrderWorkflowOptions {
  apiBaseUrl: string;
  store: KaioOrderStore;
  /** Validates the Harbor session and its provider-investor binding. No shared token. */
  resolveInvestorSession(harborAccount: string): Promise<KaioInvestorSession | null>;
  /** Provider-configured permissions, minimums, currency and dealing windows. */
  assertInstrumentAllowed(session: KaioInvestorSession, request: KaioSubscriptionRequest): Promise<void>;
  fetcher?: typeof fetch;
  now?: () => number;
}

/**
 * Authenticated backend seam; not a public HTTP route. Caller must perform its
 * normal session/CSRF checks and obtain explicit approval before invoking.
 * It creates an order only; it does not sign agreements or settle/mint shares.
 */
export class KaioOrderWorkflow {
  constructor(private readonly options: KaioOrderWorkflowOptions) {}

  async submit(input: {
    harborAccount: string;
    /** Stable UUID generated before approval, reused after connection loss. */
    attemptId: string;
    approved: true;
    request: KaioSubscriptionRequest;
  }): Promise<{ attempt: KaioOrderAttempt; providerResponse?: unknown }> {
    if (input.approved !== true || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.attemptId)) {
      throw new Error('An explicitly approved subscription attempt is required.');
    }
    const now = (this.options.now ?? Date.now)();
    const session = await this.options.resolveInvestorSession(input.harborAccount);
    if (!session || session.harborAccount !== input.harborAccount || !session.investorId || session.expiresAtMs <= now) {
      throw new Error('Connect an eligible KAIO investor session before subscribing.');
    }
    await this.options.assertInstrumentAllowed(session, input.request);
    const client = new KaioInvestorClient({
      apiBaseUrl: this.options.apiBaseUrl,
      getAccessToken: () => session.getAccessToken(),
      ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}),
    });
    const proposed: KaioOrderAttempt = {
      id: input.attemptId, harborAccount: input.harborAccount, investorId: session.investorId,
      instrumentId: input.request.instrumentId, amount: input.request.amount,
      state: 'submitting', createdAtMs: now,
    };
    const claimed = await this.options.store.claim(proposed);
    if (!claimed.inserted) {
      const stored = claimed.attempt;
      if (stored.harborAccount !== proposed.harborAccount || stored.id !== proposed.id
        || stored.investorId !== proposed.investorId || stored.instrumentId !== proposed.instrumentId
        || stored.amount !== proposed.amount) throw new Error('Subscription attempt conflicts with the saved request.');
      // Even "submitting" may already have reached KAIO before the process died.
      // No automatic repeat POST, including after rejected/unknown responses.
      return { attempt: stored };
    }
    let response: unknown;
    try {
      response = await client.createSubscription(input.request);
    } catch (error) {
      const state = error instanceof KaioApiError && !error.outcomeUnknown ? 'rejected' : 'unknown';
      await this.options.store.setState(input.harborAccount, input.attemptId, state);
      throw error;
    }
    // If persistence fails here, leave the durable claim in place: reconcile,
    // never infer rejection or retry the order submission.
    await this.options.store.setState(input.harborAccount, input.attemptId, 'received');
    return { attempt: { ...proposed, state: 'received' }, providerResponse: response };
  }
}
