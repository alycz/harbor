import { oneClickQuotePayload, verifyOneClickQuoteSignature } from '@harbor/adapters/oneclick/signature';
import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import { requireSession } from '../auth/guard.ts';
import { decodeExecutionConfig } from '../config.ts';

const Account = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const Amount = z.string().regex(/^(0|[1-9][0-9]{0,38})$/).refine(value => BigInt(value) < 2n ** 128n);
const Vault = z.object({
  balance: Amount, frozen: z.boolean(), spent_today: Amount,
  limits: z.object({ token: Account, per_action: Amount, per_day: Amount,
    buy_assets: z.array(z.string()).max(32), recipients: z.array(z.string()).max(16),
    max_slippage_bps: z.number().int().nonnegative(), expires_at_ms: z.number().int().nonnegative() }),
}).nullable();

function settings(env: unknown) {
  const config = decodeExecutionConfig(env);
  const ids = z.object({ LEASH_CONTRACT_ID: Account.optional(), LEASH_AGENT_ACCOUNT_ID: Account.optional() }).parse(env);
  if (!ids.LEASH_CONTRACT_ID || !ids.LEASH_AGENT_ACCOUNT_ID) {
    throw new AppError('SETUP_REQUIRED', 'Leash contract and agent accounts have not been configured.');
  }
  return { ...config, contract: ids.LEASH_CONTRACT_ID, agent: ids.LEASH_AGENT_ACCOUNT_ID };
}

async function view(rpc: string, contract: string, method: string, args: Record<string, string>) {
  const url = new URL(rpc);
  if (url.protocol !== 'https:' || url.username || url.password) throw new AppError('UNAVAILABLE', 'Trusted HTTPS RPC required.');
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  const response = await fetch(url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'harbor-leash', method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method,
        args_base64: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) } }) });
  if (!response.ok) throw new AppError('UNAVAILABLE', 'Leash finalized RPC read failed.');
  const body = z.object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)).max(131072) }) }).safeParse(await response.json());
  if (!body.success) throw new AppError('UNAVAILABLE', 'Invalid Leash RPC response.');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.data.result.result))) as unknown;
}

async function snapshot(env: unknown, owner: string) {
  const config = settings(env);
  const actualAgent = Account.parse(await view(config.rpcUrl, config.contract, 'get_agent', {}));
  if (actualAgent !== config.agent) throw new AppError('FORBIDDEN', 'Leash agent identity does not match configured account.');
  const vault = Vault.parse(await view(config.rpcUrl, config.contract, 'get_vault', { owner }));
  return { config, vault };
}

/** Owner-scoped read and preview only. Deliberately no execute/submit/signing endpoint. */
export function createLeashRoutes() {
  return new Hono<AppEnv>()
    .use('*', requireSession)
    .use('*', async (c, next) => { c.header('cache-control', 'no-store'); await next(); })
    .get('/vault', async c => {
      const { config, vault } = await snapshot(c.env, c.get('account'));
      return c.json({ owner: c.get('account'), contractId: config.contract, agentAccountId: config.agent,
        network: config.network, vault, observedAt: new Date().toISOString(), executionAvailable: false,
        limitation: 'Read-only integration. No authorized agent signer or transaction submission is configured.' });
    })
    .post('/preview', async c => {
      const input = z.strictObject({ quoteResponse: z.unknown() }).safeParse(await c.req.json().catch(() => null));
      if (!input.success || !await verifyOneClickQuoteSignature(input.data.quoteResponse)) {
        throw new AppError('INVALID_REQUEST', 'A valid provider-signed 1Click quote response is required.');
      }
      const owner = c.get('account');
      const { config, vault } = await snapshot(c.env, owner);
      if (config.network !== 'mainnet') throw new AppError('UNAVAILABLE', 'Provider-signed 1Click preview is mainnet-only.');
      if (!vault || vault.frozen) throw new AppError('FORBIDDEN', 'Owner vault is absent or frozen.');
      const payload = oneClickQuotePayload(input.data.quoteResponse);
      const q = JSON.parse(payload) as Record<string, unknown>;
      const amount = Amount.safeParse(q.amountIn);
      const deadline = typeof q.deadline === 'string' ? Date.parse(q.deadline) : NaN;
      if (!amount.success || BigInt(amount.data) === 0n || q.amount !== amount.data || q.dry !== false
        || q.swapType !== 'EXACT_INPUT' || q.depositType !== 'ORIGIN_CHAIN' || q.refundType !== 'ORIGIN_CHAIN'
        || q.originAsset !== `nep141:${vault.limits.token}` || q.refundTo !== owner
        || typeof q.destinationAsset !== 'string' || !vault.limits.buy_assets.includes(q.destinationAsset)
        || typeof q.recipient !== 'string' || !vault.limits.recipients.includes(q.recipient)
        || typeof q.depositAddress !== 'string' || !/^[a-f0-9]{64}$/.test(q.depositAddress)
        || typeof q.slippageTolerance !== 'number' || !Number.isInteger(q.slippageTolerance)
        || q.slippageTolerance < 0 || q.slippageTolerance > vault.limits.max_slippage_bps
        || !Number.isFinite(deadline) || deadline <= Date.now() || vault.limits.expires_at_ms <= Date.now()
        || BigInt(amount.data) > BigInt(vault.balance) || BigInt(amount.data) > BigInt(vault.limits.per_action)
        || BigInt(amount.data) > BigInt(vault.limits.per_day)) {
        throw new AppError('FORBIDDEN', 'Quote does not fit the observed owner vault limits.');
      }
      return c.json({ status: 'preview-not-approved', owner, contractId: config.contract, signedQuotePayload: payload,
        executionAvailable: false, observedAt: new Date().toISOString(),
        limitation: 'No transaction created or submitted. Contract must recheck daily usage, replay protection and limits at execution. This preview is not authority for an agent.' });
    });
}
