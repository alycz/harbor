import { TemplarClient } from '@harbor/adapters/templar/client';
import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import { requireSession } from '../auth/guard.ts';
import { decodeExecutionConfig } from '../config.ts';
import { createTemplarBorrowRoutes } from './borrow.ts';

const REGISTRY = 'v1.tmplr.near';
const Market = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.v1\.tmplr\.near$/);
const Request = z.strictObject({
  marketId: Market,
  operation: z.enum(['collateralize', 'borrow', 'repay', 'withdrawCollateral']),
  amountAtomic: z
    .string()
    .max(39)
    .regex(/^[1-9][0-9]*$/)
    .refine((value) => BigInt(value) < 2n ** 128n),
});

/** Live preparation only: no submission endpoint and no wallet signing request is returned. */
export function createTemplarRoutes() {
  return new Hono<AppEnv>()
    .route('/borrow-plans', createTemplarBorrowRoutes())
    .get('/markets', async (c) => {
      const config = decodeExecutionConfig(c.env);
      if (config.network !== 'mainnet') return c.json({ markets: [], network: config.network });
      const offset = Number(c.req.query('offset') ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000)
        throw new AppError('INVALID_REQUEST', 'Invalid offset.');
      const view = reader(config.rpcUrl);
      const deployments = z.array(z.string()).parse(await view(REGISTRY, 'list_deployments', { offset, count: 100 }));
      const markets = deployments.filter((id) => Market.safeParse(id).success && !id.startsWith('proxy-'));
      return c.json({
        markets,
        network: config.network,
        nextOffset: deployments.length === 100 ? offset + 100 : null,
        note: 'Registry deployments include retired markets. Membership is not a recommendation or evidence of current liquidity.',
      });
    })
    .get('/markets/:id', async (c) => {
      const marketId = Market.parse(c.req.param('id'));
      const config = decodeExecutionConfig(c.env);
      if (config.network !== 'mainnet') throw new AppError('UNAVAILABLE', 'Templar discovery requires mainnet.');
      const view = reader(config.rpcUrl);
      const deployment = await view(REGISTRY, 'get_deployment', { account_id: marketId });
      if (!deployment) throw new AppError('NOT_FOUND', 'Market not found in Templar registry.');
      const configuration = await new TemplarClient(view, new Set([marketId])).configuration(marketId);
      const allowed = z
        .object({ TEMPLAR_ALLOWED_MARKETS: z.string().default('') })
        .parse(c.env)
        .TEMPLAR_ALLOWED_MARKETS.split(',')
        .map((s) => s.trim())
        .includes(marketId);
      return c.json({
        marketId,
        network: 'mainnet',
        protocol: 'templar',
        configuration,
        observedAt: new Date().toISOString(),
        source: 'finalized NEAR contract read',
        borrowingEnabled: config.executionEnabled && config.writeAdapters.has('templar') && allowed,
        note: 'Credit market, not an earn APY. Registry can include retired markets. Rates, liquidity and collateral health must be reviewed before borrowing.',
      });
    })
    .post('/prepare', requireSession, async (c) => {
      const input = Request.safeParse(await c.req.json().catch(() => null));
      if (!input.success) throw new AppError('INVALID_REQUEST', 'Send a market, operation and positive atomic amount.');
      const config = decodeExecutionConfig(c.env);
      if (config.network !== 'mainnet')
        throw new AppError('UNAVAILABLE', 'Templar mainnet registry is not used on testnet.');
      const view = reader(config.rpcUrl);
      const { marketId, operation, amountAtomic } = input.data;
      const deployment = await view(REGISTRY, 'get_deployment', { account_id: marketId });
      if (deployment === null) throw new AppError('INVALID_REQUEST', 'Market is not registered with Templar.');
      const record = z
        .object({ version_key: z.string(), code_hash: z.string(), block_height: z.union([z.string(), z.number()]) })
        .parse(deployment);
      const client = new TemplarClient(view, new Set([marketId]));
      const configuration = await client.configuration(marketId);
      const registration = await client.registration(marketId, c.get('account'));
      const transaction = await client[operation](marketId, amountAtomic);
      return c.json({
        network: config.network,
        accountId: c.get('account'),
        marketId,
        operation,
        amountAtomic,
        deployment: record,
        configuration,
        registration,
        preparedTransaction: transaction,
        executable: false,
        signing: null,
        status: 'prepared',
        limitation:
          'Real contract calls prepared. Use the separate borrow-plan review for enabled markets. This preparation endpoint does not submit a loan.',
      });
    });
}

export function reader(rpcUrl: string) {
  return async (accountId: string, methodName: string, args: Record<string, unknown>): Promise<unknown> => {
    const encoded = new TextEncoder().encode(JSON.stringify(args));
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'harbor-templar',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: accountId,
          method_name: methodName,
          args_base64: btoa(Array.from(encoded, (byte) => String.fromCharCode(byte)).join('')),
        },
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
    });
    if (!response.ok) throw new AppError('UNAVAILABLE', 'Templar chain read failed.');
    const body = z
      .object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)).max(1000000) }) })
      .safeParse(await response.json());
    if (!body.success) throw new AppError('UNAVAILABLE', 'Templar chain read returned an invalid result.');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.data.result.result))) as unknown;
  };
}
