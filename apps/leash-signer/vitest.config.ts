import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': new URL('./test/cloudflare-stub.ts', import.meta.url).pathname } },
});
