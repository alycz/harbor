import { createRheaLending } from '@harbor/adapters/rhea/lending';
import { parseDecimalAmount, MAX_U128_RAW } from '@harbor/domain/amount';
import { parseOneClickAssetId } from '@harbor/domain/asset';
import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.ts';
import { requireSession } from '../auth/guard.ts';
import { decodeExecutionConfig } from '../config.ts';
import { assetRegistry } from '../execution/assets.ts';

const Request = z.strictObject({ assetId: z.string().min(1).max(320), amount: z.string().min(1).max(64) });

/** Real contract-backed supply preparation, not a write-enabled lending lifecycle. */
export function createLendingRoutes() {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireSession);
  routes.use('*', async (c, next) => { c.header('cache-control', 'no-store'); await next(); });
  routes.get('/rhea/assets', (c) => {
    const config = decodeExecutionConfig(c.env);
    return c.json({ assets: assetRegistry(config.network).list().filter((asset) => asset.chain === 'near') });
  });
  routes.post('/rhea/prepare', async (c) => {
    const config = decodeExecutionConfig(c.env);
    if (config.network !== 'mainnet') throw new AppError('UNAVAILABLE', 'Rhea lending has no configured testnet integration.');
    const parsed = Request.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError('INVALID_REQUEST', 'Select an asset and a positive supply amount.');
    const asset = assetRegistry(config.network).byId(parsed.data.assetId);
    const identity = asset && parseOneClickAssetId(asset.canonicalId);
    if (!asset || asset.chain !== 'near' || identity?.standard !== 'nep141') {
      throw new AppError('INVALID_REQUEST', 'Choose a verified NEAR fungible token.');
    }
    let amount: bigint;
    try { amount = parseDecimalAmount(parsed.data.amount, asset.decimals, MAX_U128_RAW); }
    catch { throw new AppError('INVALID_REQUEST', 'Enter a positive amount within token precision.'); }
    if (amount <= 0n) throw new AppError('INVALID_REQUEST', 'Enter a positive amount within token precision.');
    try {
      const plan = await createRheaLending(config.rpcUrl).prepareSupply({
        network: 'near:mainnet', accountId: c.get('account'), tokenId: identity.contractId, amount,
      });
      // Do not expose a send/approve route: swap policies do not authorize lending.
      return c.json({ plan, asset, executionEnabled: false, status: 'prepared-not-approved',
        limitation: 'Lending-specific policy approval and settlement verification are not yet implemented. No funds have moved.' });
    } catch {
      throw new AppError('UNAVAILABLE', 'Rhea preparation failed. Check asset deposit availability, wallet balance and Rhea storage registration, then retry.');
    }
  });
  return routes;
}
