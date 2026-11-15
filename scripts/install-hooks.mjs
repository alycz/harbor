// Installs the git hooks after `pnpm install`. A source download without a .git directory has no
// hooks to install, and that must not stop the install.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.LEFTHOOK !== '0' && existsSync(new URL('../.git', import.meta.url))) {
  const result = spawnSync('pnpm', ['exec', 'lefthook', 'install'], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
