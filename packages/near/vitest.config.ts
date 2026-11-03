import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Runs inside workerd, so these tests also show near-api-js works where Harbor deploys it.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/wrangler.jsonc' },
      // Live mainnet reads run only when asked for: HARBOR_LIVE_NEAR=1 pnpm test
      miniflare: { bindings: { HARBOR_LIVE_NEAR: process.env.HARBOR_LIVE_NEAR ?? '' } },
    }),
  ],
  test: { fsModuleCachePath: 'node_modules/.vitest-cache' },
});
