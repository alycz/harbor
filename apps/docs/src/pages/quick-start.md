# Quick start

## Requirements

Use Node.js 24 or newer and the pnpm version pinned in the repository's `packageManager` field. A local checkout requires no wallet, model key, or Cloudflare deployment.

```sh
git clone https://github.com/alycz/harbor.git
cd harbor
nvm use
pnpm run setup
pnpm dev
```

Open the URL printed by Vite. `pnpm run setup` installs locked dependencies, generates Worker types, and applies migrations to local D1. Use `run`: bare `pnpm setup` configures pnpm itself instead of Harbor.

## What to expect

The default network is NEAR mainnet, but financial execution is disabled. Chat returns a clearly labeled scripted response without a model key. Mainnet dry quotes can contact 1Click; “local” does not mean all reads are offline. Research comes from the committed snapshot, which can be empty.

To configure an optional model or read endpoint:

```sh
cp .dev.vars.example apps/worker/.dev.vars
```

Edit that ignored file locally. Do not paste keys into chat, commit credentials, or enable execution to work around an error. See [configuration](/developers/configuration).

## Run the documentation

The Vocs site is separate from the application server:

```sh
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

Use the URL each command prints. Documentation changes live in `apps/docs/src/pages`; existing architecture decisions remain in `docs/architecture-decisions.md`. Building docs does not deploy the application or documentation.

## Verify your checkout

```sh
pnpm check
```

This runs formatting/lint checks, workspace type checks, tests, builds, and unused-code checks. See [contributing](/developers/contributing) for CI's additional Worker checks.

Source: [setup script](https://github.com/alycz/harbor/blob/main/scripts/setup.sh), [root commands](https://github.com/alycz/harbor/blob/main/package.json).
