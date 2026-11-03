import path from 'node:path';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
// Agent tests run against a scripted model: one tool call, then an answer, for every turn.
const FAUX_SCRIPT = [
  { toolCall: { name: 'list_markets', args: { kind: 'yield_pools', symbol: 'USDC', limit: 3 } } },
  { text: 'The snapshot lists the highest USDC yields with their capture time.' },
];

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Pinned so a developer's .dev.vars (network, real provider key) never leaks into tests.
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          NEAR_NETWORK: 'mainnet',
          EXECUTION_ENABLED: 'false',
          ENABLED_WRITE_ADAPTERS: '',
          PI_PROVIDER: 'faux',
          PI_FAUX_SCRIPT: JSON.stringify(FAUX_SCRIPT),
          OPENROUTER_API_KEY: 'test-placeholder',
          // Tests share one guest subject, so the per-guest window is opened wide; admission has its own tests.
          AGENT_GUEST_TURNS_PER_15_MIN: '10000',
          AGENT_MAX_ACTIVE_RUNS: '100',
          // Tests never reach 1Click with a developer's credentials, whatever .dev.vars holds.
          ONE_CLICK_JWT: '',
        },
      },
    }),
  ],
  test: {
    fsModuleCachePath: 'node_modules/.vitest-cache',
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
