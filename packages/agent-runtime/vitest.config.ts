import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Pi compatibility gate (docs/architecture-decisions.md): these tests run Pi inside workerd with the
// production compatibility date.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './test/wrangler.jsonc' } })],
  test: { fsModuleCachePath: 'node_modules/.vitest-cache' },
});
