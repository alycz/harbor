import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/wrangler.jsonc' },
      // Live 1Click reads run only when asked for: HARBOR_LIVE_ONECLICK=1 pnpm test
      miniflare: { bindings: { HARBOR_LIVE_ONECLICK: process.env.HARBOR_LIVE_ONECLICK ?? '' } },
    }),
  ],
  test: { fsModuleCachePath: 'node_modules/.vitest-cache' },
});
