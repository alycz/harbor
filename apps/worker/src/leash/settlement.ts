import { oneClickQuoteHash } from '@harbor/adapters/oneclick/signature';
import type { SwapExecutor } from '@harbor/adapters/venue';
import type { NearChain } from '@harbor/near/chain';
import { type EvmReader, verifyDelivery } from '../execution/delivery.ts';
import type { ExecutionDeps } from '../execution/store.ts';
import { type LeashRequest, verifyLeashPayment } from './execution.ts';

/** Call only with the durable approved request and baseline, never browser/model-supplied state.
 * This function is read-only. Provider success alone never produces settlement success.
 */
export async function reconcileLeashDelivery(
  input: {
    request: LeashRequest;
    txHash: string;
    quoteResponse: unknown;
    recipientBalanceBeforeRaw: bigint | null;
  },
  deps: { chain: NearChain; evm: EvmReader; executor: SwapExecutor; assets: ExecutionDeps['assets'] },
) {
  try {
    const payment = verifyLeashPayment(
      await deps.chain.transaction(input.txHash, input.request.signerId),
      input.request,
      input.txHash,
    );
    if (payment !== 'payment-confirmed-delivery-unverified') return { state: payment, settled: false as const };
    const quote = JSON.parse(input.request.args.quote) as Record<string, unknown>;
    const asset = typeof quote.destinationAsset === 'string' ? deps.assets.byId(quote.destinationAsset) : undefined;
    if (
      !asset ||
      typeof quote.recipient !== 'string' ||
      typeof quote.depositAddress !== 'string' ||
      typeof quote.minAmountOut !== 'string' ||
      !/^[1-9][0-9]*$/.test(quote.minAmountOut)
    ) {
      return { state: 'delivery-unverifiable', settled: false as const };
    }
    // Bind provider lookup to the exact signed request, not a substituted response.
    const { oneClickQuotePayload } = await import('@harbor/adapters/oneclick/signature');
    if (oneClickQuotePayload(input.quoteResponse) !== input.request.args.quote)
      return { state: 'quote-mismatch', settled: false as const };
    const report = await deps.executor.status({
      depositAddress: quote.depositAddress,
      memo: typeof quote.depositMemo === 'string' ? quote.depositMemo : null,
      quoteHash: await oneClickQuoteHash(input.quoteResponse),
    });
    if (report.status === 'REFUNDED') return { state: 'refund-reported-unverified', settled: false as const };
    if (report.status !== 'SUCCESS')
      return {
        state: report.status === 'FAILED' ? 'provider-failure-reported' : 'delivery-pending',
        settled: false as const,
      };
    const delivery = await verifyDelivery(deps.chain, deps.evm, {
      chain: asset.chain,
      recipient: quote.recipient,
      buyAsset: asset.canonicalId,
      minOutRaw: BigInt(quote.minAmountOut),
      balanceBeforeRaw: input.recipientBalanceBeforeRaw,
      deliveryTxHashes: report.deliveryTxHashes,
    });
    return delivery.verified
      ? {
          state: 'delivery-verified',
          settled: true as const,
          txHash: delivery.txHash,
          receivedRaw: delivery.receivedRaw.toString(),
        }
      : { state: 'delivery-unverified', settled: false as const, reason: delivery.reason };
  } catch {
    return { state: 'outcome-unknown', settled: false as const };
  }
}
