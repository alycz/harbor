import { createRheaLending } from '@harbor/adapters/rhea/lending';
import { MAX_U128_RAW, parseDecimalAmount } from '@harbor/domain/amount';
import { parseOneClickAssetId } from '@harbor/domain/asset';
import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import { recipientOf, requireSession } from '../auth/guard.ts';
import { decodeExecutionConfig } from '../config.ts';
import { assetRegistry } from '../execution/assets.ts';

import { approveSupply, cancelSupply, claimSupply, createSupply, readSupply, settleSupply } from './lifecycle.ts';

const Request = z.strictObject({ assetId: z.string().min(1).max(320), amount: z.string().min(1).max(64) });

/** Supply-specific, one-time owner approval. Never reuses swap or autonomous-agent authority. */
export function createLendingRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireSession);
  routes.use('*', async (c, next) => {
    c.header('cache-control', 'no-store');
    await next();
  });
  routes.get('/rhea/assets', (c) => {
    const config = decodeExecutionConfig(c.env);
    return c.json({
      assets: assetRegistry(config.network)
        .list()
        .filter((asset) => asset.chain === 'near'),
    });
  });
  // Discovery is read-only. Deposit support is verified on-chain, not inferred from a ticker.
  routes.get('/rhea/opportunities', async (c) => {
    const config = decodeExecutionConfig(c.env);
    if (config.network !== 'mainnet') {
      return c.json({
        opportunities: [],
        unavailable: [],
        observedAt: new Date().toISOString(),
        executionEnabled: false,
      });
    }
    const candidates = assetRegistry(config.network)
      .list()
      .filter((asset) => asset.chain === 'near' && parseOneClickAssetId(asset.canonicalId)?.standard === 'nep141');
    const adapter = createRheaLending(config.rpcUrl);
    const opportunities: Array<{
      assetId: string;
      tokenId: string;
      symbol: string;
      protocol: string;
      network: string;
      supplyEnabled: boolean;
      apy: null;
    }> = [];
    const unavailable: string[] = [];
    // Bounded concurrency avoids overwhelming the RPC and preserves partial results.
    for (let offset = 0; offset < candidates.length; offset += 6) {
      await Promise.all(
        candidates.slice(offset, offset + 6).map(async (asset) => {
          const identity = parseOneClickAssetId(asset.canonicalId);
          if (identity?.standard !== 'nep141') return;
          try {
            const market = await adapter.asset(identity.contractId);
            if (market.config.can_deposit)
              opportunities.push({
                assetId: asset.canonicalId,
                tokenId: identity.contractId,
                symbol: asset.symbol,
                protocol: 'rhea-lending',
                network: 'near:mainnet',
                supplyEnabled: true,
                apy: null,
              });
          } catch {
            unavailable.push(asset.canonicalId);
          }
        }),
      );
    }
    opportunities.sort((a, b) => a.assetId.localeCompare(b.assetId));
    return c.json({
      opportunities,
      unavailable,
      observedAt: new Date().toISOString(),
      executionEnabled: config.executionEnabled && config.writeAdapters.has('rhea-lending'),
    });
  });
  routes.post('/rhea/prepare', async (c) => {
    const config = decodeExecutionConfig(c.env);
    if (config.network !== 'mainnet')
      throw new AppError('UNAVAILABLE', 'Rhea lending has no configured testnet integration.');
    const parsed = Request.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Select an asset and a positive supply amount.');
    const asset = assetRegistry(config.network).byId(parsed.data.assetId);
    const identity = asset && parseOneClickAssetId(asset.canonicalId);
    if (asset?.chain !== 'near' || identity?.standard !== 'nep141') {
      throw new AppError('INVALID_REQUEST', 'Choose a verified NEAR fungible token.');
    }
    let amount: bigint;
    try {
      amount = parseDecimalAmount(parsed.data.amount, asset.decimals, MAX_U128_RAW);
    } catch {
      throw new AppError('INVALID_REQUEST', 'Enter a positive amount within token precision.');
    }
    if (amount <= 0n) throw new AppError('INVALID_REQUEST', 'Enter a positive amount within token precision.');
    try {
      const plan = await createRheaLending(config.rpcUrl).prepareSupply({
        network: 'near:mainnet',
        accountId: c.get('account'),
        tokenId: identity.contractId,
        amount,
      });
      const executionEnabled = config.executionEnabled && config.writeAdapters.has('rhea-lending');
      const key = c.req.header('idempotency-key');
      const approval =
        executionEnabled && key ? await createSupply(c.env, c.get('account'), recipientOf(c), key, plan) : null;
      return c.json({
        plan,
        asset,
        executionEnabled,
        approval,
        status: 'prepared-not-approved',
        limitation: executionEnabled
          ? 'Review the one-time supply approval, then sign the transaction in your wallet. No funds have moved yet.'
          : 'Rhea execution is disabled by the operator. Preview only; no funds have moved.',
      });
    } catch {
      throw new AppError(
        'UNAVAILABLE',
        'Rhea preparation failed. Check asset deposit availability, wallet balance and Rhea storage registration, then retry.',
      );
    }
  });
  routes.get('/rhea/plans/:id', async (c) => c.json(await readSupply(c.env, c.get('account'), c.req.param('id'))));
  routes.post('/rhea/plans/:id/approve', async (c) => {
    const body = z
      .strictObject({
        digest: z.string().regex(/^[0-9a-f]{64}$/),
        publicKey: z.string().max(128),
        signature: z.string().max(256),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new AppError('INVALID_REQUEST', 'Send the wallet approval signature.');
    return c.json(await approveSupply(c.env, c.get('account'), c.req.param('id'), body.data, recipientOf(c)));
  });
  routes.post('/rhea/plans/:id/claim', async (c) =>
    c.json(await claimSupply(c.env, c.get('account'), c.req.param('id'))),
  );
  routes.post('/rhea/plans/:id/cancel', async (c) =>
    c.json(await cancelSupply(c.env, c.get('account'), c.req.param('id'))),
  );
  routes.post('/rhea/plans/:id/settle', async (c) => {
    const body = z
      .strictObject({ txHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new AppError('INVALID_REQUEST', 'Send a transaction hash from your wallet.');
    return c.json(await settleSupply(c.env, c.get('account'), c.req.param('id'), body.data.txHash));
  });
  return routes;
}
