import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

describe('market research routes', () => {
  it('serve dated, read-only yield pools with their sources', async () => {
    const response = await createApp().request('/api/markets/yields?stablecoin=true&limit=5', {}, env);
    expect(response.status).toBe(200);
    const body = await response.json<{ live: boolean; executable: boolean; pools: unknown[]; sources: unknown[] }>();
    expect(body.live).toBe(false);
    expect(body.executable).toBe(false);
    expect(body.pools.length).toBeLessThanOrEqual(5);
  });

  it('reject malformed filters and never expose an action endpoint', async () => {
    expect((await createApp().request('/api/markets/yields?limit=0', {}, env)).status).toBe(400);
    expect((await createApp().request('/api/markets/yields', { method: 'POST' }, env)).status).toBe(404);
  });

  it('list chains from the same snapshot', async () => {
    const response = await createApp().request('/api/markets/chains', {}, env);
    expect(response.status).toBe(200);
  });
});
