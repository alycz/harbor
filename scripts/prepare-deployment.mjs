import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [network, databaseId, ...options] = process.argv.slice(2);
if (!['mainnet', 'testnet'].includes(network) || !/^[a-f0-9-]{36}$/.test(databaseId ?? '')) {
  throw new Error(
    'Usage: node scripts/prepare-deployment.mjs mainnet|testnet DATABASE_ID [--enable-execution] [--enable-templar] [--write-adapters=oneclick,rhea-lending,templar] [--domain=HOSTNAME] [--leash=CONTRACT,AGENT,CODE_HASH]',
  );
}
const adapterOptions = options.filter((option) => option.startsWith('--write-adapters='));
if (adapterOptions.length > 1) throw new Error('Specify --write-adapters only once.');
const adapterOption = adapterOptions[0];
const domainOption = options.find((option) => option.startsWith('--domain='));
// Leash: the deployed vault contract, the agent it trusts, and the reviewed code hash Harbor pins.
// Turns on owner-approved agent dispatch through the private harbor-leash-signer Worker.
const leashOption = options.find((option) => option.startsWith('--leash='));
const leashParts = leashOption?.slice('--leash='.length).split(',');
const NEAR_ACCOUNT = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
if (
  leashParts &&
  (leashParts.length !== 3 ||
    !NEAR_ACCOUNT.test(leashParts[0] ?? '') ||
    !NEAR_ACCOUNT.test(leashParts[1] ?? '') ||
    !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(leashParts[2] ?? ''))
)
  throw new Error('--leash takes CONTRACT_ACCOUNT,AGENT_ACCOUNT,BASE58_CODE_HASH.');
const domain = domainOption?.slice('--domain='.length);
if (domain !== undefined && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) throw new Error('Invalid --domain hostname.');
if (
  options.some(
    (option) =>
      option !== '--enable-execution' &&
      option !== '--enable-templar' &&
      option !== domainOption &&
      option !== leashOption &&
      option !== adapterOption,
  )
)
  throw new Error('Unknown deployment option.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'apps/web/dist/harbor/wrangler.json');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));
if (typeof source.main !== 'string' || typeof source.assets?.directory !== 'string' || !source.vars) {
  throw new Error('Run the default pnpm build before preparing deployment.');
}
// Preserve an existing selection unless the operator explicitly replaces it. Never carry
// the built configuration's global execution switch into a newly generated deployment.
const enableTemplar = options.includes('--enable-templar');
const execution = options.includes('--enable-execution') || enableTemplar;
const selected =
  adapterOption === undefined
    ? (source.vars.ENABLED_WRITE_ADAPTERS ?? '')
    : adapterOption.slice('--write-adapters='.length);
if (typeof selected !== 'string') throw new Error('ENABLED_WRITE_ADAPTERS must be a comma-separated string.');
const supported = new Set(['oneclick', 'rhea-lending', 'templar']);
const adapterNames = selected === '' ? [] : selected.split(',').map((name) => name.trim());
// Explicit opt-in sets BOTH switches; preserve other selected adapters.
if (enableTemplar) adapterNames.push('templar');
if (adapterNames.some((name) => !supported.has(name))) {
  throw new Error('Supported write adapters: oneclick,rhea-lending,templar. KAIO is not enabled.');
}
if (network === 'testnet' && (execution || (adapterOption !== undefined && adapterNames.length > 0))) {
  throw new Error('These execution adapters are mainnet-only; testnet must remain execution-disabled.');
}
const adapters = network === 'mainnet' ? [...new Set(adapterNames)].join(',') : '';
if (leashParts && (network !== 'mainnet' || !execution || !adapters.split(',').includes('oneclick'))) {
  throw new Error('Leash dispatches 1Click deposits on mainnet: it needs --enable-execution with oneclick.');
}
if (execution && adapters === '') {
  throw new Error('Execution requires an explicit nonempty adapter selection or a selection in the built config.');
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
    ENABLED_WRITE_ADAPTERS: adapters,
    ...(leashParts
      ? {
          LEASH_CONTRACT_ID: leashParts[0],
          LEASH_AGENT_ACCOUNT_ID: leashParts[1],
          LEASH_CONTRACT_CODE_HASH: leashParts[2],
          LEASH_EXECUTION_ENABLED: 'true',
        }
      : {}),
  },
  services: [
    ...(source.services ?? []),
    // A private binding, never a public URL: the signer has no route of its own.
    ...(leashParts ? [{ binding: 'LEASH_SIGNER', service: 'harbor-leash-signer' }] : []),
  ],
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
