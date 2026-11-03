import { parseResearchSnapshot } from '@harbor/data/research';
import { AppError } from '@harbor/domain/errors';
import { Hono } from 'hono';
import { z } from 'zod';

import snapshotJson from '../../../../research/data/research-snapshot.json';
import type { AppEnv } from '../app.ts';

const research = parseResearchSnapshot(snapshotJson);
const YieldQuerySchema = z.object({
  chain: z.string().max(32).optional(),
  symbol: z.string().max(32).optional(),
  stablecoin: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Read-only market research. Every answer is a dated snapshot, never a live rate or a quote. */
export function createMarketRoutes() {
  return new Hono<AppEnv>()
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
    .get('/chains', (c) => {
      c.header('cache-control', 'public, max-age=300');
      return c.json({ live: false, sources: research.sources, chains: research.chains });
    });
}
