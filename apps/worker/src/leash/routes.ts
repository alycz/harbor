import { createOneClickClient } from '@harbor/adapters/oneclick/client';
import { oneClickQuotePayload, verifyOneClickQuoteSignature } from '@harbor/adapters/oneclick/signature';
import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import { requireSession } from '../auth/guard.ts';
import { createLeashDispatchRoutes, leashAvailable } from '../autopilot/leash-dispatch.ts';
import { decodeExecutionConfig } from '../config.ts';
import { executionDeps } from '../execution/store.ts';
import { fitsLeashPreview } from './preview-policy.ts';
import { leashQuoteRequest } from './quote-request.ts';

const Account = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const Amount = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,38})$/)
  .refine((value) => BigInt(value) < 2n ** 128n);
const Vault = z
  .object({
    balance: Amount,
    frozen: z.boolean(),
    spent_today: Amount,
    limits: z.object({
      token: Account,
      per_action: Amount,
      per_day: Amount,
      buy_assets: z.array(z.string()).max(32),
      recipients: z.array(z.string()).max(16),
      max_slippage_bps: z.number().int().nonnegative(),
      expires_at_ms: z.number().int().nonnegative(),
    }),
  })
  .nullable();

function settings(env: unknown) {
  const config = decodeExecutionConfig(env);
  const ids = z
    .object({ LEASH_CONTRACT_ID: Account.optional(), LEASH_AGENT_ACCOUNT_ID: Account.optional() })
    .parse(env);
  if (!ids.LEASH_CONTRACT_ID || !ids.LEASH_AGENT_ACCOUNT_ID) {
    throw new AppError('SETUP_REQUIRED', 'Leash contract and agent accounts have not been configured.');
  }
  return { ...config, contract: ids.LEASH_CONTRACT_ID, agent: ids.LEASH_AGENT_ACCOUNT_ID };
}

async function view(rpc: string, contract: string, method: string, args: Record<string, string>) {
  const url = new URL(rpc);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new AppError('UNAVAILABLE', 'Trusted HTTPS RPC required.');
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'harbor-leash',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contract,
        method_name: method,
        args_base64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')),
      },
    }),
  });
  if (!response.ok) throw new AppError('UNAVAILABLE', 'Leash finalized RPC read failed.');
  const body = z
    .object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)).max(131072) }) })
    .safeParse(await response.json());
  if (!body.success) throw new AppError('UNAVAILABLE', 'Invalid Leash RPC response.');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.data.result.result))) as unknown;
}

export async function leashSnapshot(env: unknown, owner: string) {
  const config = settings(env);
  const actualAgent = Account.parse(await view(config.rpcUrl, config.contract, 'get_agent', {}));
  if (actualAgent !== config.agent)
    throw new AppError('FORBIDDEN', 'Leash agent identity does not match configured account.');
  const vault = Vault.parse(await view(config.rpcUrl, config.contract, 'get_vault', { owner }));
  return { config, vault };
}

/** Owner-scoped preparation plus explicitly approved private signer dispatch. */
export function createLeashRoutes() {
  return new Hono<AppEnv>()
    .use('*', requireSession)
    .use('*', async (c, next) => {
      c.header('cache-control', 'no-store');
      await next();
    })
    .get('/vault', async (c) => {
      const { config, vault } = await leashSnapshot(c.env, c.get('account'));
      return c.json({
        owner: c.get('account'),
        contractId: config.contract,
        agentAccountId: config.agent,
        network: config.network,
        vault,
        observedAt: new Date().toISOString(),
        executionAvailable: leashAvailable(c.env),
        limitation: leashAvailable(c.env)
          ? 'Explicit owner approval and current contract validation required before dispatch.'
          : 'Agent dispatch requires a private signer binding, reviewed code hash and execution configuration.',
      });
    })
    .post('/prepare-owner-action', async (c) => {
      const Limits = z.strictObject({
        token: Account,
        per_action: Amount,
        per_day: Amount,
        buy_assets: z.array(z.string().min(1).max(320)).min(1).max(32),
        recipients: z.array(z.string().min(1).max(256)).min(1).max(16),
        max_slippage_bps: z.number().int().min(0).max(10000),
        expires_at_ms: z.number().int().positive(),
      });
      const input = z
        .discriminatedUnion('operation', [
          z.strictObject({ operation: z.literal('set_limits'), limits: Limits, storageDepositYocto: Amount }),
          z.strictObject({ operation: z.literal('freeze') }),
          z.strictObject({ operation: z.literal('unfreeze') }),
          z.strictObject({ operation: z.literal('withdraw'), amount: Amount }),
          z.strictObject({ operation: z.literal('fund'), amount: Amount }),
        ])
        .safeParse(await c.req.json().catch(() => null));
      if (!input.success)
        throw new AppError('INVALID_REQUEST', 'Send an explicit vault operation with canonical atomic amounts.');
      const owner = c.get('account');
      const { config, vault } = await leashSnapshot(c.env, owner);
      const action = input.data;
      let receiverId = config.contract;
      let methodName: string = action.operation;
      let args: Record<string, unknown> = {};
      let deposit = '0';
      if (action.operation === 'set_limits') {
        if (
          action.limits.expires_at_ms <= Date.now() ||
          BigInt(action.limits.per_action) === 0n ||
          BigInt(action.limits.per_action) > BigInt(action.limits.per_day)
        ) {
          throw new AppError('INVALID_REQUEST', 'Choose positive spending caps and a future expiry.');
        }
        if (vault && BigInt(vault.balance) > 0n && vault.limits.token !== action.limits.token) {
          throw new AppError('FORBIDDEN', 'Withdraw the existing token before changing it.');
        }
        args = { limits: action.limits };
        deposit = action.storageDepositYocto;
      } else {
        if (!vault) throw new AppError('FORBIDDEN', 'Set vault limits before this operation.');
        if (action.operation === 'withdraw' || action.operation === 'fund') {
          if (BigInt(action.amount) === 0n) throw new AppError('INVALID_REQUEST', 'Amount must be positive.');
          if (action.operation === 'withdraw') {
            if (BigInt(action.amount) > BigInt(vault.balance))
              throw new AppError('FORBIDDEN', 'Amount exceeds observed vault balance.');
            args = { amount: action.amount };
          } else {
            receiverId = vault.limits.token;
            methodName = 'ft_transfer_call';
            deposit = '1';
            args = { receiver_id: config.contract, amount: action.amount, msg: '' };
          }
        }
      }
      return c.json({
        status: 'unsigned-owner-transaction',
        signerId: owner,
        network: config.network,
        transaction: {
          receiverId,
          actions: [{ type: 'FunctionCall', params: { methodName, args, gas: '100000000000000', deposit } }],
        },
        executionAvailable: leashAvailable(c.env),
        limitation:
          'No funds moved. Review exact caps, recipients and attached NEAR in your own wallet. Storage/registration and contract checks may reject this transaction. Harbor does not sign or submit.',
      });
    })
    .post('/quote', async (c) => {
      const owner = c.get('account');
      const { config, vault } = await leashSnapshot(c.env, owner);
      if (config.network !== 'mainnet' || !config.executionEnabled || !config.writeAdapters.has('oneclick'))
        throw new AppError('EXECUTION_DISABLED', 'Executable 1Click quote requests are not enabled.');
      const request = leashQuoteRequest(await c.req.json().catch(() => null), owner, vault);
      const asset = executionDeps(c.env).assets.byId(request.destinationAsset);
      if (!asset || !['near', 'eth', 'base', 'arb'].includes(asset.chain))
        throw new AppError('FORBIDDEN', 'Choose a destination with independently verifiable delivery.');
      const client = createOneClickClient({
        allowExecutableQuotes: true,
        ...(config.oneClickJwt ? { jwt: config.oneClickJwt } : {}),
      });
      const { response } = await client.quote(request);
      const signedQuotePayload = validateLeashQuote(response, owner, vault);
      return c.json({
        quoteResponse: response,
        signedQuotePayload,
        status: 'preview-not-approved',
        limitation: 'Provider-signed quote only. No approval, signature or funds transfer has occurred.',
      });
    })
    .post('/preview', async (c) => {
      const input = z.strictObject({ quoteResponse: z.unknown() }).safeParse(await c.req.json().catch(() => null));
      if (!input.success || !(await verifyOneClickQuoteSignature(input.data.quoteResponse))) {
        throw new AppError('INVALID_REQUEST', 'A valid provider-signed 1Click quote response is required.');
      }
      const owner = c.get('account');
      const { config, vault } = await leashSnapshot(c.env, owner);
      if (config.network !== 'mainnet')
        throw new AppError('UNAVAILABLE', 'Provider-signed 1Click preview is mainnet-only.');
      if (!vault || vault.frozen) throw new AppError('FORBIDDEN', 'Owner vault is absent or frozen.');
      const payload = validateLeashQuote(input.data.quoteResponse, owner, vault);
      return c.json({
        status: 'preview-not-approved',
        owner,
        contractId: config.contract,
        signedQuotePayload: payload,
        agentTransaction: {
          signerId: config.agent,
          receiverId: config.contract,
          actions: [
            {
              type: 'FunctionCall',
              params: {
                methodName: 'execute',
                args: {
                  owner,
                  quote: payload,
                  signature: (input.data.quoteResponse as { signature: string }).signature,
                },
                gas: '100000000000000',
                deposit: '0',
              },
            },
          ],
        },
        executionAvailable: leashAvailable(c.env),
        observedAt: new Date().toISOString(),
        limitation:
          'No transaction created or submitted. Contract must recheck daily usage, replay protection and limits at execution. This preview is not authority for an agent.',
      });
    })
    .route('/', createLeashDispatchRoutes());
}

export function validateLeashQuote(quoteResponse: unknown, owner: string, vault: z.infer<typeof Vault>) {
  if (!vault || vault.frozen) throw new AppError('FORBIDDEN', 'Owner vault is absent or frozen.');
  const payload = oneClickQuotePayload(quoteResponse);
  const q = JSON.parse(payload) as Record<string, unknown>;
  if (!fitsLeashPreview(q, owner, vault)) {
    throw new AppError('FORBIDDEN', 'Quote does not fit the observed owner vault limits.');
  }

  return payload;
}
