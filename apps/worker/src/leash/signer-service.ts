import { isTxHash } from '@harbor/near/chain';
import { z } from 'zod';
import type { BoundedLeashSigner } from './execution.ts';

/** Explicit service-binding protocol, not an adapter to an unspecified wallet provider.
 * The separately deployed signer must enforce execute-only key scope and durable idempotency.
 * No credential is accepted here; no binding is installed by this module.
 */
export function createLeashServiceSigner(
  service: Pick<Fetcher, 'fetch'>,
  accountId: string,
  contractId: string,
): BoundedLeashSigner {
  return {
    accountId,
    contractId,
    async submit(request, idempotencyKey) {
      if (
        request.network !== 'mainnet' ||
        request.signerId !== accountId ||
        request.receiverId !== contractId ||
        request.methodName !== 'execute' ||
        request.deposit !== '0' ||
        request.gas !== '100000000000000'
      ) {
        throw new Error('Request exceeds signer binding scope');
      }
      const response = await service.fetch('https://leash-signer.internal/v1/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(15000),
        redirect: 'manual',
      });
      if (!response.ok) throw new Error('Signer outcome unavailable; recover without resubmission');
      const result = z
        .object({ txHash: z.string(), signerId: z.literal(accountId), contractId: z.literal(contractId) })
        .parse(await response.json());
      if (!isTxHash(result.txHash)) throw new Error('Signer returned invalid transaction hash');
      return { txHash: result.txHash };
    },
  };
}
