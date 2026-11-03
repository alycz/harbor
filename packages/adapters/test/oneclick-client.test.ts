import { describe, expect, it, vi } from 'vitest';

import { createOneClickClient, OneClickClientError, type OneClickQuoteRequest } from '../src/oneclick/client.ts';

const request: OneClickQuoteRequest = {
  dry: true,
  swapType: 'EXACT_INPUT',
  slippageTolerance: 100,
  originAsset: 'nep141:origin.token.near',
  depositType: 'ORIGIN_CHAIN',
  destinationAsset: 'nep141:destination.token.near',
  amount: '1000000',
  refundTo: 'refund.near',
  refundType: 'ORIGIN_CHAIN',
  recipient: 'recipient.near',
  recipientType: 'DESTINATION_CHAIN',
  deadline: '2027-01-01T00:00:00.000Z',
  confidentiality: 'public',
};

function quoteResponse(extraQuote: Record<string, unknown> = {}) {
  return {
    correlationId: 'quote-correlation',
    timestamp: '2026-10-26T00:00:00.000Z',
    signature: 'provider-signature',
    quoteRequest: request,
    quote: {
      amountIn: '1000000',
      amountInFormatted: '1',
      amountInUsd: '1',
      minAmountIn: '1000000',
      amountOut: '995000',
      amountOutFormatted: '0.995',
      amountOutUsd: '0.995',
      minAmountOut: '990000',
      timeEstimate: 120,
      ...extraQuote,
    },
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  });
}

function rawJsonResponse(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'application/json' } });
}

describe('1Click client', () => {
  it('uses the pinned endpoint, rejects redirects, and verifies dry quotes before returning them', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://1click.chaindefuser.com/v0/quote');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('manual');
      expect(JSON.parse(String(init?.body))).toEqual(request);
      return jsonResponse(quoteResponse());
    });
    const verifier = vi.fn(() => true);
    const client = createOneClickClient({ fetch: fetcher, verifyQuoteSignature: verifier });

    const result = await client.quote(request);

    expect(verifier).toHaveBeenCalledOnce();
    expect(result.response.quote.depositAddress).toBeUndefined();
    expect(result.quoteHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('refuses a redirect instead of following it', async () => {
    const client = createOneClickClient({
      fetch: async () =>
        new Response(null, { status: 302, headers: { location: 'https://attacker.example/v0/tokens' } }),
    });
    await expect(client.tokens()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('fails closed on an invalid provider signature', async () => {
    const client = createOneClickClient({
      fetch: async () => jsonResponse(quoteResponse()),
      verifyQuoteSignature: () => false,
    });

    await expect(client.quote(request)).rejects.toMatchObject({
      code: 'INVALID_SIGNATURE',
    });
  });

  it('rejects executable fields in a dry quote even when the signature verifier succeeds', async () => {
    const client = createOneClickClient({
      fetch: async () => jsonResponse(quoteResponse({ depositAddress: 'deposit.near' })),
      verifyQuoteSignature: () => true,
    });

    await expect(client.quote(request)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects executable quote requests before calling the provider', async () => {
    const fetcher = vi.fn();
    const client = createOneClickClient({ fetch: fetcher });

    await expect(client.quote({ ...request, dry: false })).rejects.toBeInstanceOf(OneClickClientError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends and binds both deposit address and memo for status', async () => {
    const executableQuote = quoteResponse({
      depositAddress: 'deposit.near',
      depositMemo: '12345',
      deadline: '2027-01-01T00:00:00.000Z',
      timeWhenInactive: '2026-12-31T23:00:00.000Z',
    });
    executableQuote.quoteRequest = { ...request, dry: false };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(
        'https://1click.chaindefuser.com/v0/status?depositAddress=deposit.near&depositMemo=12345',
      );
      return jsonResponse({
        correlationId: 'quote-correlation',
        quoteResponse: executableQuote,
        status: 'PROCESSING',
        updatedAt: '2026-10-26T00:01:00.000Z',
        swapDetails: {
          intentHashes: [],
          nearTxHashes: [],
          originChainTxHashes: [],
          destinationChainTxHashes: [],
        },
      });
    });
    const client = createOneClickClient({ fetch: fetcher, verifyQuoteSignature: () => true });

    const result = await client.status({
      depositAddress: 'deposit.near',
      depositMemo: '12345',
    });

    expect(result.status).toBe('PROCESSING');
    expect(result.quoteResponse.quote.depositMemo).toBe('12345');
  });

  it('binds status to the expected quote correlation and canonical hash', async () => {
    const executableQuote = quoteResponse({
      depositAddress: 'deposit.near',
      deadline: '2027-01-01T00:00:00.000Z',
      timeWhenInactive: '2026-12-31T23:00:00.000Z',
    });
    executableQuote.quoteRequest = { ...request, dry: false };
    const quoteClient = createOneClickClient({
      allowExecutableQuotes: true,
      fetch: async () => jsonResponse(executableQuote),
      verifyQuoteSignature: () => true,
    });
    const { quoteHash } = await quoteClient.quote(executableQuote.quoteRequest);
    const statusBody = {
      correlationId: 'quote-correlation',
      quoteResponse: executableQuote,
      status: 'PROCESSING',
      updatedAt: '2026-10-26T00:01:00.000Z',
      swapDetails: {
        intentHashes: [],
        nearTxHashes: [],
        originChainTxHashes: [],
        destinationChainTxHashes: [],
      },
    };
    const statusClient = createOneClickClient({
      fetch: async () => jsonResponse(statusBody),
      verifyQuoteSignature: () => true,
    });

    await expect(
      statusClient.status({
        depositAddress: 'deposit.near',
        expectedCorrelationId: 'quote-correlation',
        expectedQuoteHash: quoteHash,
      }),
    ).resolves.toMatchObject({ status: 'PROCESSING' });
    await expect(
      statusClient.status({
        depositAddress: 'deposit.near',
        expectedCorrelationId: 'another-correlation',
        expectedQuoteHash: quoteHash,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_MISMATCH' });
    await expect(
      statusClient.status({
        depositAddress: 'deposit.near',
        expectedCorrelationId: 'quote-correlation',
        expectedQuoteHash: '1'.repeat(44),
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_MISMATCH' });
  });

  it('rejects unknown provider status values as non-success', async () => {
    const executableQuote = quoteResponse({
      depositAddress: 'deposit.near',
      deadline: '2027-01-01T00:00:00.000Z',
      timeWhenInactive: '2026-12-31T23:00:00.000Z',
    });
    executableQuote.quoteRequest = { ...request, dry: false };
    const client = createOneClickClient({
      fetch: async () =>
        jsonResponse({
          correlationId: 'quote-correlation',
          quoteResponse: executableQuote,
          status: 'UNKNOWN_PROVIDER_STATE',
          updatedAt: '2026-10-26T00:01:00.000Z',
          swapDetails: {
            intentHashes: [],
            nearTxHashes: [],
            originChainTxHashes: [],
            destinationChainTxHashes: [],
          },
        }),
      verifyQuoteSignature: () => true,
    });

    await expect(client.status({ depositAddress: 'deposit.near' })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('bounds token responses before parsing them', async () => {
    const client = createOneClickClient({
      maxResponseBytes: 16,
      fetch: async () =>
        new Response('[]', {
          headers: { 'content-type': 'application/json', 'content-length': '17' },
        }),
    });

    await expect(client.tokens()).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    });
  });

  it('normalizes live token prices while preserving official chain codes and asset IDs', async () => {
    const client = createOneClickClient({
      fetch: async () =>
        jsonResponse([
          {
            assetId: 'nep141:sol.omft.near',
            decimals: 9,
            blockchain: 'sol',
            symbol: 'SOL',
            price: '2.50',
            priceUpdatedAt: '2026-10-26T00:00:00.000Z',
          },
        ]),
    });

    await expect(client.tokens()).resolves.toEqual([
      expect.objectContaining({
        assetId: 'nep141:sol.omft.near',
        blockchain: 'sol',
        price: 2.5,
      }),
    ]);
  });

  it('accepts chain codes it has not seen before and rejects malformed ones', async () => {
    const tokens = [
      { assetId: 'nep141:qtc.omft.near', decimals: 18, blockchain: 'qtc', symbol: 'QTC' },
      { assetId: 'nep141:abs.omdep.near', decimals: 18, blockchain: 'abs', symbol: 'ETH' },
    ].map((token) => ({
      ...token,
      price: 1,
      priceUpdatedAt: '2026-10-26T00:00:00.000Z',
    }));
    const client = createOneClickClient({ fetch: async () => jsonResponse(tokens) });
    await expect(client.tokens()).resolves.toEqual(tokens);
    const malformed = createOneClickClient({
      fetch: async () => jsonResponse([{ ...tokens[0], blockchain: 'Not A Chain' }]),
    });
    await expect(malformed.tokens()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('keeps missing provider resources in an explicit unknown-outcome state', async () => {
    const client = createOneClickClient({
      fetch: async () => jsonResponse({}, { status: 404 }),
    });

    await expect(client.tokens()).rejects.toMatchObject({
      code: 'UNKNOWN_OUTCOME',
    });
  });

  it('maps a provider deadline abort to a distinct timeout error', async () => {
    const client = createOneClickClient({
      fetch: async () => {
        throw new DOMException('request timed out', 'TimeoutError');
      },
    });

    await expect(client.tokens()).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('propagates caller cancellation without converting it to provider success or timeout', async () => {
    const caller = new AbortController();
    const fetcher = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          expect(signal).toBeInstanceOf(AbortSignal);
          signal?.addEventListener(
            'abort',
            () => {
              reject(signal.reason ?? new DOMException('cancelled', 'AbortError'));
            },
            { once: true },
          );
        }),
    );
    const client = createOneClickClient({
      fetch: fetcher,
      signal: caller.signal,
      timeoutMs: 10_000,
    });

    const pending = client.tokens();
    caller.abort(new DOMException('browser request closed', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not dispatch a provider request when the caller is already cancelled', async () => {
    const caller = new AbortController();
    caller.abort(new DOMException('browser request closed', 'AbortError'));
    const fetcher = vi.fn();
    const client = createOneClickClient({
      fetch: fetcher,
      signal: caller.signal,
    });

    await expect(client.tokens()).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects deeply layered quote and status JSON before signature canonicalization', async () => {
    const deeplyLayeredJson = `${'['.repeat(66)}0${']'.repeat(66)}`;
    const verifier = vi.fn(() => true);
    const quoteClient = createOneClickClient({
      fetch: async () => rawJsonResponse(deeplyLayeredJson),
      verifyQuoteSignature: verifier,
    });
    const statusClient = createOneClickClient({
      fetch: async () => rawJsonResponse(deeplyLayeredJson),
      verifyQuoteSignature: verifier,
    });

    await expect(quoteClient.quote(request)).rejects.toMatchObject({
      code: 'RESPONSE_TOO_COMPLEX',
    });
    await expect(statusClient.status({ depositAddress: 'deposit.near' })).rejects.toMatchObject({
      code: 'RESPONSE_TOO_COMPLEX',
    });
    expect(verifier).not.toHaveBeenCalled();
  });

  it('rejects excessive token JSON nodes before schema validation', async () => {
    const tooManyNodesJson = `[${'0,'.repeat(100_000)}0]`;
    const client = createOneClickClient({
      fetch: async () => rawJsonResponse(tooManyNodesJson),
    });

    await expect(client.tokens()).rejects.toMatchObject({
      code: 'RESPONSE_TOO_COMPLEX',
    });
  });

  it('rejects insecure or credential-bearing explorer links in status responses', async () => {
    const executableQuote = quoteResponse({
      depositAddress: 'deposit.near',
      deadline: '2027-01-01T00:00:00.000Z',
      timeWhenInactive: '2026-12-31T23:00:00.000Z',
    });
    executableQuote.quoteRequest = { ...request, dry: false };
    const client = createOneClickClient({
      fetch: async () =>
        jsonResponse({
          correlationId: 'quote-correlation',
          quoteResponse: executableQuote,
          status: 'PROCESSING',
          updatedAt: '2026-10-26T00:01:00.000Z',
          swapDetails: {
            intentHashes: [],
            nearTxHashes: [],
            originChainTxHashes: [{ hash: 'origin-tx', explorerUrl: 'http://user:pass@example.test/tx' }],
            destinationChainTxHashes: [],
          },
        }),
      verifyQuoteSignature: () => true,
    });

    await expect(client.status({ depositAddress: 'deposit.near' })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
