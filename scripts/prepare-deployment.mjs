import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [network, databaseId, ...options] = process.argv.slice(2);
if (!['mainnet', 'testnet'].includes(network) || !/^[a-f0-9-]{36}$/.test(databaseId ?? '')) {
  throw new Error(
    'Usage: node scripts/prepare-deployment.mjs mainnet|testnet DATABASE_ID [--enable-execution] [--domain=HOSTNAME]',
  );
}
const domainOption = options.find((option) => option.startsWith('--domain='));
const domain = domainOption?.slice('--domain='.length);
if (domain !== undefined && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) throw new Error('Invalid --domain hostname.');
if (options.some((option) => option !== '--enable-execution' && option !== domainOption))
  throw new Error('Unknown deployment option.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'apps/web/dist/harbor/wrangler.json');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
if (typeof source.main !== 'string' || typeof source.assets?.directory !== 'string' || !source.vars) {
  throw new Error('Run the default pnpm build before preparing deployment.');
}
// The docs are served from the same origin under /docs: copy the built site (`pnpm docs:build`, base path
// /docs) into the Worker's static assets.
const docsBuild = path.join(root, 'apps/docs/dist/public');
if (!(await stat(path.join(docsBuild, 'index.html')).catch(() => null))) {
  throw new Error('Run pnpm docs:build before preparing deployment.');
}
await cp(docsBuild, path.join(path.resolve(path.dirname(sourcePath), source.assets.directory), 'docs'), {
  recursive: true,
});
const execution = options.includes('--enable-execution');
// 1Click has no testnet, so execution adapters exist on mainnet only.
const adapters = network === 'mainnet' ? 'oneclick' : '';
const config = {
  name: network === 'mainnet' ? 'harbor' : 'harbor-testnet',
  main: path.resolve(path.dirname(sourcePath), source.main),
  no_bundle: source.no_bundle,
  rules: source.rules,
  compatibility_date: source.compatibility_date,
  compatibility_flags: source.compatibility_flags,
  workers_dev: true,
  ...(domain ? { routes: [{ pattern: domain, custom_domain: true }] } : {}),
  preview_urls: false,
  observability: { enabled: true },
  triggers: source.triggers,
  assets: { ...source.assets, directory: path.resolve(path.dirname(sourcePath), source.assets.directory) },
  vars: {
    ...source.vars,
    NEAR_NETWORK: network,
    EXECUTION_ENABLED: String(execution),
    ENABLED_WRITE_ADAPTERS: execution ? adapters : '',
  },
  durable_objects: source.durable_objects,
  migrations: source.migrations,
  d1_databases: [
    {
      binding: 'DB',
      database_name: `harbor-${network}`,
      database_id: databaseId,
      migrations_dir: path.join(root, 'apps/worker/migrations'),
    },
  ],
};
const directory = path.join(root, '.wrangler/deploy', network);
await mkdir(directory, { recursive: true });
const destination = path.join(directory, 'wrangler.json');
await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`);
process.stdout.write(`${destination}\n`);
