import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Runs inside workerd, so these tests also show near-api-js works where Harbor deploys it.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './test/wrangler.jsonc' } })],
  test: { fsModuleCachePath: 'node_modules/.vitest-cache' },
});
