import { formatRawAmount } from '@harbor/domain/amount';
import type { AssetRef } from '@harbor/domain/asset';

import {
  type DepositQuote,
  type SettlementReport,
  type SwapExecutor,
  type SwapVenue,
  type VenueQuote,
  VenueRefusal,
} from '../venue.ts';
import { type OneClickClient, OneClickClientError, type VerifiedOneClickQuote } from './client.ts';

/**
 * Stand-in addresses for a dry quote made before an account is known. A dry quote never creates a
 * deposit address and nothing can be sent against it, so these only satisfy the address format each
 * chain requires. A plan that executes asks for a fresh quote with the user's own addresses.
 */
const DRY_QUOTE_ADDRESS: Readonly<Record<string, string>> = {
  near: 'intents.near',
  eth: '0x1111111111111111111111111111111111111111',
  arb: '0x1111111111111111111111111111111111111111',
  base: '0x1111111111111111111111111111111111111111',
  sol: 'So11111111111111111111111111111111111111112',
};
const QUOTE_DEADLINE_MS = 60 * 60 * 1000;

/** 1Click as a swap venue. It only ever asks for dry quotes; executing one is the plan lifecycle's job. */
export function oneClickVenue(client: Pick<OneClickClient, 'quote'>, now: () => number = Date.now): SwapVenue {
  return {
    id: 'oneclick',
    async quote(request): Promise<VenueQuote> {
      const refundTo = request.refundTo ?? DRY_QUOTE_ADDRESS[request.sell.chain];
      const recipient = request.recipient ?? DRY_QUOTE_ADDRESS[request.buy.chain];
      if (!refundTo || !recipient) {
        throw new VenueRefusal(
          'UNSUPPORTED_CHAIN',
          `Harbor cannot quote ${request.sell.symbol} to ${request.buy.symbol} yet.`,
        );
      }
      let verified: VerifiedOneClickQuote;
      try {
        verified = await client.quote({
          dry: true,
          swapType: 'EXACT_INPUT',
          slippageTolerance: request.slippageBps,
          originAsset: request.sell.canonicalId,
          depositType: 'ORIGIN_CHAIN',
          destinationAsset: request.buy.canonicalId,
          amount: request.amountIn.toString(),
          refundTo,
          refundType: 'ORIGIN_CHAIN',
          recipient,
          recipientType: 'DESTINATION_CHAIN',
          deadline: new Date(now() + QUOTE_DEADLINE_MS).toISOString(),
        });
      } catch (error) {
        // 1Click answers 4xx when it has no route for a pair or size; that is a refusal, not an outage.
        if (error instanceof OneClickClientError && error.code === 'HTTP_ERROR' && /HTTP 4\d\d/.test(error.message)) {
          throw new VenueRefusal('NO_ROUTE', refusalText(error.providerMessage, request.sell));
        }
        throw error;
      }
      const { quote } = verified.response;
      return {
        amountIn: BigInt(quote.amountIn),
        amountOut: BigInt(quote.amountOut),
        minAmountOut: BigInt(quote.minAmountOut),
        // 1Click does not report price impact, so the policy check treats it as unknown.
        priceImpactBps: null,
        platform: 'NEAR Intents',
        protocols: ['NEAR Intents'],
        raw: { quoteHash: verified.quoteHash, response: verified.response },
      };
    },
  };
}

/** How long an executable quote's deposit address takes deposits before 1Click refunds instead. */
const EXECUTABLE_DEADLINE_MS = 10 * 60 * 1000;

/**
 * 1Click as an executor: executable quotes that deliver to the owner's own recipient and refund to
 * their own account, deposit notice, and signed status reports. It never signs or sends anything.
 */
export function oneClickExecutor(
  client: Pick<OneClickClient, 'quote' | 'status' | 'submitDeposit'>,
  now: () => number = Date.now,
): SwapExecutor {
  return {
    id: 'oneclick',
    async executableQuote(request): Promise<DepositQuote> {
      let verified: VerifiedOneClickQuote;
      try {
        verified = await client.quote({
          dry: false,
          swapType: 'EXACT_INPUT',
          slippageTolerance: request.slippageBps,
          originAsset: request.sell.canonicalId,
          depositType: 'ORIGIN_CHAIN',
          destinationAsset: request.buy.canonicalId,
          amount: request.amountIn.toString(),
          refundTo: request.refundTo,
          refundType: 'ORIGIN_CHAIN',
          recipient: request.recipient,
          recipientType: 'DESTINATION_CHAIN',
          deadline: new Date(now() + EXECUTABLE_DEADLINE_MS).toISOString(),
        });
      } catch (error) {
        if (error instanceof OneClickClientError && error.code === 'HTTP_ERROR' && /HTTP 4\d\d/.test(error.message)) {
          throw new VenueRefusal('NO_ROUTE', refusalText(error.providerMessage, request.sell));
        }
        throw error;
      }
      const { quote, correlationId } = verified.response;
      if (!quote.depositAddress || !quote.deadline) {
        throw new OneClickClientError('INVALID_RESPONSE', 'The executable quote has no deposit address');
      }
      return {
        amountIn: BigInt(quote.amountIn),
        amountOut: BigInt(quote.amountOut),
        minAmountOut: BigInt(quote.minAmountOut),
        priceImpactBps: null,
        platform: 'NEAR Intents',
        protocols: ['NEAR Intents'],
        raw: { quoteHash: verified.quoteHash, response: verified.response },
        deposit: {
          address: quote.depositAddress,
          memo: quote.depositMemo ?? null,
          deadlineMs: Date.parse(quote.deadline),
          quoteHash: verified.quoteHash,
          correlationId,
        },
      };
    },
    async submitDeposit(input) {
      await client.submitDeposit({
        txHash: input.txHash,
        depositAddress: input.depositAddress,
        nearSenderAccount: input.sender,
        ...(input.memo ? { memo: input.memo } : {}),
      });
    },
    async status(input): Promise<SettlementReport> {
      const report = await client.status({
        depositAddress: input.depositAddress,
        ...(input.memo ? { depositMemo: input.memo } : {}),
        expectedQuoteHash: input.quoteHash,
      });
      const details = report.swapDetails;
      return {
        status: report.status,
        amountOut: details.amountOut ? BigInt(details.amountOut) : null,
        refundedAmount: details.refundedAmount ? BigInt(details.refundedAmount) : null,
        refundReason: details.refundReason ?? null,
        deliveryTxHashes: details.destinationChainTxHashes.map((entry) => entry.hash),
        updatedAt: report.updatedAt,
      };
    },
  };
}

/** A refusal the user can act on. Only a minimum amount is read from 1Click's text; nothing is echoed. */
function refusalText(providerMessage: string | undefined, sell: AssetRef): string {
  const minimum = providerMessage ? /at least (\d{1,40})\b/.exec(providerMessage)?.[1] : undefined;
  if (!minimum) return 'NEAR Intents has no route for this pair and amount right now.';
  // Round up to two decimals so the suggested amount clears the minimum.
  const step = 10n ** BigInt(Math.max(0, sell.decimals - 2));
  const rounded = ((BigInt(minimum) + step - 1n) / step) * step;
  return `This amount is below the bridge minimum. Try at least ${formatRawAmount(rounded, sell.decimals)} ${sell.symbol}.`;
}
