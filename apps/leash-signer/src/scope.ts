import { z } from 'zod';

const account = z
  .string()
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
  .min(2)
  .max(64);
const requestSchema = z
  .object({
    network: z.literal('mainnet'),
    signerId: account,
    receiverId: account,
    methodName: z.literal('execute'),
    gas: z.literal('100000000000000'),
    deposit: z.literal('0'),
    args: z
      .object({ owner: account, quote: z.string().min(1).max(32768), signature: z.string().min(1).max(512) })
      .strict(),
  })
  .strict();
export function checkScope(value: unknown, agent: string, contract: string) {
  const request = requestSchema.parse(value);
  if (request.signerId !== agent || request.receiverId !== contract) throw new Error('Scope mismatch');
  const quote = JSON.parse(request.args.quote);
  if (
    quote.dry !== false ||
    quote.refundTo !== request.args.owner ||
    !Number.isFinite(Date.parse(quote.deadline)) ||
    Date.parse(quote.deadline) <= Date.now()
  )
    throw new Error('Expired or unbound quote');
  return request;
}
export function checkKey(permission: unknown, contract: string) {
  const parsed = z
    .object({
      FunctionCall: z.object({
        receiver_id: z.literal(contract),
        method_names: z.tuple([z.literal('execute')]),
        allowance: z.string().regex(/^[1-9][0-9]*$/),
      }),
    })
    .strict()
    .safeParse(permission);
  if (!parsed.success) throw new Error('Signer requires a funded execute-only function-call access key');
}
