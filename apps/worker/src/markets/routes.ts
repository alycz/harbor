import { parseResearchSnapshot } from '@harbor/data/research';
import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { z } from 'zod';

import snapshotJson from '../../../../research/data/research-snapshot.json';
import type { AppEnv } from '../app.ts';
import { decodeExecutionConfig } from '../config.ts';
import { assetRegistry } from '../execution/assets.ts';
import { type LiveEarn, readLiveEarn } from './live.ts';

const research = parseResearchSnapshot(snapshotJson);
const LIVE_TTL_MS = 120_000;
/** Per-isolate cache: the live figures change slowly, and every page view should not hit three upstreams. */
let live: { at: number; body: Promise<LiveEarn> } | null = null;
const YieldQuerySchema = z.object({
  chain: z.string().max(32).optional(),
  symbol: z.string().max(32).optional(),
  stablecoin: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Read-only market research. Every answer is a dated snapshot, never a live rate or a quote. */
export function createMarketRoutes() {
  return (
    new Hono<AppEnv>()
      .get('/yields', (c) => {
        const query = YieldQuerySchema.safeParse(c.req.query());
        if (!query.success) throw new AppError('INVALID_REQUEST', 'Filter by chain, symbol, stablecoin and limit.');
        const { chain, symbol, stablecoin, limit } = query.data;
        const pools = research.yieldPools
          .filter((pool) => !chain || pool.chain.toLowerCase() === chain.toLowerCase())
          .filter((pool) => !symbol || pool.symbol.toUpperCase().split('-').includes(symbol.toUpperCase()))
          .filter((pool) => stablecoin === undefined || pool.stablecoin === (stablecoin === 'true'))
          .sort((a, b) => (b.totalApyPct ?? -1) - (a.totalApyPct ?? -1))
          .slice(0, limit);
        c.header('cache-control', 'public, max-age=300');
        return c.json({ live: false, executable: false, sources: research.sources, caveats: research.caveats, pools });
      })
      // Live rates for what Harbor can deposit into: Rhea from the contract, the 1Click vaults from their sources.
      .get('/live', async (c) => {
        const config = decodeExecutionConfig(c.env);
        if (config.network !== 'mainnet') return c.json({ fetchedAt: new Date().toISOString(), rhea: [], vaults: [] });
        if (!live || Date.now() - live.at > LIVE_TTL_MS) {
          const body = readLiveEarn(config.rpcUrl, assetRegistry(config.network).list());
          live = { at: Date.now(), body };
          // A failed read must not be cached for the full window.
          body.catch(() => {
            if (live?.body === body) live = null;
          });
        }
        c.header('cache-control', 'public, max-age=60');
        return c.json(await live.body);
      })
      .get('/chains', (c) => {
        c.header('cache-control', 'public, max-age=300');
        return c.json({ live: false, sources: research.sources, chains: research.chains });
      })
  );
}
