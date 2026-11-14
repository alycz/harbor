// Creates the Leash agent's execute-only key and hands its private half straight to Cloudflare.
//
// The key pair exists only in this process's memory: the private key is piped into
// `wrangler secret put` and never printed, logged or written to disk. Only the public key is
// printed, to register on the agent account as a function-call key for `execute`.
//
//   pnpm provision-key                              # stores the secret on harbor-leash-signer
//   pnpm provision-key --dry-run                    # prints a throwaway public key, stores nothing
import { spawn } from 'node:child_process';
import { KeyPair } from 'near-api-js';

const WORKER = 'harbor-leash-signer';
const dryRun = process.argv.includes('--dry-run');

const pair = KeyPair.fromRandom('ed25519');
const publicKey = pair.getPublicKey().toString();

if (dryRun) {
  console.log(`Dry run: nothing stored. Throwaway public key: ${publicKey}`);
  process.exit(0);
}

const wrangler = spawn('pnpm', ['exec', 'wrangler', 'secret', 'put', 'LEASH_AGENT_PRIVATE_KEY', '--name', WORKER], {
  stdio: ['pipe', 'inherit', 'inherit'],
});
wrangler.stdin.end(pair.toString());
wrangler.on('close', (code) => {
  if (code !== 0) {
    console.error('\nCloudflare did not store the key. Nothing was registered on chain; run this again.');
    process.exit(code ?? 1);
  }
  console.log(`\nStored on ${WORKER}. Register this PUBLIC key on the agent account:\n\n  ${publicKey}\n`);
});
