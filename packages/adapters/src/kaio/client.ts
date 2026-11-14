/**
 * KAIO investor subscription API. This is an order request, NOT a mint receipt.
 * Source: official GitBook-linked Postman collection 26092879/2s93Xu36Mm.
 * Auth/onboarding, agreement signing and admin settlement remain provider-owned.
 */
export interface KaioSubscriptionRequest {
  instrumentId: string;
  /** Canonical decimal subscription currency amount; not token atomic units. */
  amount: string;
}

export interface KaioClientOptions {
  /** Explicit confirmed KAIO endpoint, ending in /api/v1. No guessed default. */
  apiBaseUrl: string;
  /** Investor-scoped token from the caller's authorized KAIO login. Never persist/log. */
  getAccessToken: () => Promise<string>;
  fetcher?: typeof fetch;
}

export class KaioApiError extends Error {
  constructor(public readonly status: number, public readonly outcomeUnknown: boolean) {
    super(outcomeUnknown
      ? 'KAIO request outcome is unknown. Reconcile orders before retrying.'
      : `KAIO request rejected (${status}).`);
    this.name = 'KaioApiError';
  }
}

/** Call only from an authenticated, explicitly user-approved order flow. */
export class KaioInvestorClient {
  private readonly base: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: KaioClientOptions) {
    const url = new URL(options.apiBaseUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'api.librecapital.com'
      || url.port || url.username || url.password || url.search || url.hash
      || url.pathname.replace(/\/$/, '') !== '/api/v1') {
      throw new Error('KAIO requires a confirmed official HTTPS /api/v1 endpoint.');
    }
    this.base = url.href.replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch;
  }

  /** Raw provider result: deliberately never interpreted as settled/minted. */
  async createSubscription(request: KaioSubscriptionRequest): Promise<unknown> {
    if (!/^[a-fA-F0-9]{24}$/.test(request.instrumentId)) {
      throw new Error('Expected the KAIO instrument ID, not a ticker or contract address.');
    }
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(request.amount)
      || request.amount.length > 64 || !/[1-9]/.test(request.amount)) {
      throw new Error('Expected a positive canonical decimal subscription amount.');
    }
    // KAIO documents a JSON number. Preserve decimal digits without JS float conversion.
    const body = `{"instrumentId":${JSON.stringify(request.instrumentId)},"amount":${request.amount}}`;
    return this.request('/orderbook/subscription/order', 'POST', body);
  }

  async getOrder(orderId: string): Promise<unknown> {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(orderId)) throw new Error('Invalid KAIO order ID.');
    return this.request(`/orderbook/order/${encodeURIComponent(orderId)}`, 'GET');
  }

  /** Use after interrupted submission; never automatically resubmit an unknown outcome. */
  async listOrders(): Promise<unknown> {
    return this.request('/orderbook/order', 'GET');
  }

  private async request(path: string, method: 'GET' | 'POST', body?: string): Promise<unknown> {
    const token = await this.options.getAccessToken();
    if (!token || /\s/.test(token)) throw new Error('An authorized KAIO investor session is required.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetcher(`${this.base}${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body }), signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) throw new KaioApiError(response.status, method === 'POST' && response.status >= 500);
      return await response.json();
    } catch (error) {
      if (error instanceof KaioApiError) throw error;
      // Covers network loss and undecodable responses after a potentially accepted write.
      throw new KaioApiError(0, method === 'POST');
    } finally {
      clearTimeout(timer);
    }
  }
}
