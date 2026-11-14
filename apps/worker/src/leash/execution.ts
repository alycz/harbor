import { oneClickQuotePayload, verifyOneClickQuoteSignature } from '@harbor/adapters/oneclick/signature';
import { isTxHash } from '@harbor/near/chain';
import { z } from 'zod';

export interface LeashExecution {
  id: string;
  owner: string;
  contract: string;
  agent: string;
  quoteResponse: unknown;
}
export interface LeashRequest {
  network: 'mainnet';
  signerId: string;
  receiverId: string;
  methodName: 'execute';
  args: { owner: string; quote: string; signature: string };
  gas: '100000000000000';
  deposit: '0';
}
export interface BoundedLeashSigner {
  /** Implementations must hold only execute-scoped authority for the configured agent/contract. */
  accountId: string;
  contractId: string;
  submit(request: Readonly<LeashRequest>, idempotencyKey: string): Promise<{ txHash: string }>;
}
export interface LeashJournal {
  /** Atomic durable claim BEFORE any signer request. Never release a claim on ambiguous failure. */
  claim(id: string, owner: string, digest: string): Promise<boolean>;
  submitted(id: string, digest: string, txHash: string): Promise<void>;
  unknown(id: string, digest: string): Promise<void>;
}

/** Internal coordinator, not an HTTP route. No signer implementation or credentials supplied. */
export async function submitLeash(
  input: LeashExecution,
  deps: {
    enabled: boolean;
    contractId: string;
    agentAccountId: string;
    signer: BoundedLeashSigner | null;
    journal: LeashJournal;
    /** Finalized contract/vault read, spending/reserve checks and reviewed code identity. Fail closed. */
    authorize: (input: LeashExecution) => Promise<boolean>;
  },
) {
  if (!deps.enabled || !deps.signer) throw new Error('Leash signer is not enabled');
  if (
    input.contract !== deps.contractId ||
    input.agent !== deps.agentAccountId ||
    deps.signer.accountId !== input.agent ||
    deps.signer.contractId !== input.contract
  )
    throw new Error('Signer scope mismatch');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.id)) throw new Error('Invalid execution ID');
  if (!(await verifyOneClickQuoteSignature(input.quoteResponse))) throw new Error('Invalid provider quote signature');
  const quote = oneClickQuotePayload(input.quoteResponse);
  const parsed = JSON.parse(quote) as Record<string, unknown>;
  const deadline = typeof parsed.deadline === 'string' ? Date.parse(parsed.deadline) : NaN;
  if (parsed.dry !== false || parsed.refundTo !== input.owner || !Number.isFinite(deadline) || deadline <= Date.now()) {
    throw new Error('Quote is not a current owner-bound execution quote');
  }
  if (!(await deps.authorize(input))) throw new Error('Current vault authorization denied');
  const request: LeashRequest = {
    network: 'mainnet',
    signerId: input.agent,
    receiverId: input.contract,
    methodName: 'execute',
    args: { owner: input.owner, quote, signature: (input.quoteResponse as { signature: string }).signature },
    gas: '100000000000000',
    deposit: '0',
  };
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request)))),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
  if (!(await deps.journal.claim(input.id, input.owner, digest)))
    throw new Error('Execution already claimed; recover its outcome instead of resubmitting');
  try {
    const result = await deps.signer.submit(Object.freeze({ ...request, args: Object.freeze(request.args) }), input.id);
    if (!isTxHash(result.txHash)) throw new Error('Signer returned an invalid transaction hash');
    await deps.journal.submitted(input.id, digest, result.txHash);
    return { state: 'submitted-not-settled' as const, txHash: result.txHash, request };
  } catch (error) {
    await deps.journal.unknown(input.id, digest).catch(() => {});
    throw new Error('Outcome unknown; never retry submission automatically. Recover from signer and chain history.', {
      cause: error,
    });
  }
}

/** A wallet callback/provider status is not evidence. Final exact execution is only payment, not delivery. */
export function verifyLeashPayment(value: unknown, request: LeashRequest, hash: string) {
  const parsed = z
    .object({
      final_execution_status: z.literal('FINAL'),
      transaction: z.object({
        hash: z.string(),
        signer_id: z.string(),
        receiver_id: z.string(),
        actions: z.array(
          z.object({
            FunctionCall: z.object({
              method_name: z.string(),
              args: z.string(),
              gas: z.union([z.string(), z.number()]),
              deposit: z.string(),
            }),
          }),
        ),
      }),
      status: z.record(z.string(), z.unknown()),
      receipts_outcome: z.array(z.object({ outcome: z.object({ status: z.record(z.string(), z.unknown()) }) })).min(1),
    })
    .safeParse(value);
  if (!parsed.success) return 'pending' as const;
  const tx = parsed.data.transaction;
  const call = tx.actions[0]?.FunctionCall;
  if (
    tx.hash !== hash ||
    tx.signer_id !== request.signerId ||
    tx.receiver_id !== request.receiverId ||
    tx.actions.length !== 1 ||
    !call ||
    call.method_name !== 'execute' ||
    String(call.gas) !== request.gas ||
    call.deposit !== '0'
  )
    return 'mismatch' as const;
  try {
    const args = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(call.args), (c) => c.charCodeAt(0))));
    if (
      Object.keys(args).length !== 3 ||
      args.owner !== request.args.owner ||
      args.quote !== request.args.quote ||
      args.signature !== request.args.signature
    )
      return 'mismatch' as const;
  } catch {
    return 'mismatch' as const;
  }
  if ('Failure' in parsed.data.status || parsed.data.receipts_outcome.some((r) => 'Failure' in r.outcome.status))
    return 'failed' as const;
  if (
    !('SuccessValue' in parsed.data.status) ||
    parsed.data.receipts_outcome.some(
      (r) => !('SuccessValue' in r.outcome.status) && !('SuccessReceiptId' in r.outcome.status),
    )
  )
    return 'pending' as const;
  return 'payment-confirmed-delivery-unverified' as const;
}
