# Harbor

A cross-chain DeFi agent that acts on its own, but only inside limits you signed.

- You ask in plain language.
- Harbor compares real venues across chains, proposes a plan, and you sign one policy: budget, allowed assets, your own addresses only, schedule and expiry.
- The agent executes through [NEAR Intents](https://docs.near-intents.org) and records a verified receipt for each action.
- Anything outside the policy comes back to you for approval, and you can freeze the agent at any time.

## The demo

A poisoned post tells the agent to send all funds to another account. The agent reads it, but outside text is data, never an instruction. Even a model that obeys it gets nowhere: the destination isn't one you signed, so the plan is blocked (`DESTINATION_NOT_OWN`), your policy check says `block`, and nothing reaches 1Click. See [docs/demo.md](docs/demo.md).

## Status

Harbor is being built for the NEAR hackathon. This is what runs today. "Tested" means automated tests in workerd; "live" means checked against the real service.

| Area | State |
|---|---|
| Wallet sign-in (NEP-413 through NEAR Connect, full-access key check) | Built and tested. Not yet run with a real wallet. |
| Accounts own their data | Plans, alerts, policies and strategies are scoped to the signed-in account. |
| Signed policy: per-asset spend limits, assets, own destinations, slippage, schedule, expiry; freeze and revoke | Built and tested with an independent NEP-413 signer. Signing needs a real wallet. |
| Real swaps: executable 1Click quote for your own addresses, one wallet transaction, on-chain deposit check | Built and tested; executable quotes checked live. A real signed deposit has not been made yet. |
| Settlement: verified 1Click status, delivery measured on the destination chain, refunds and unknowns kept apart | Built and tested with recorded-shape status answers. |
| Agent acting on its own: recurring buys queued under the signed policy, signed by you in one tap | Built and tested. |
| Leash contract: the agent spends a vault only on 1Click-signed deposits to your own addresses, within caps (`contracts/leash`) | Built, 18 contract tests. Not deployed, and the Worker does not call it yet. |
| Poisoned-post block | Built and tested through the real agent loop with a model scripted to obey the post. |
| Models: NEAR AI Cloud (attested TEE models only) or free OpenRouter models | Built. Needs a key; without one, chat is scripted. |
| Research and Earn | Built, on a dated snapshot that shows its source and capture time. Earn has no deposit flow yet. |
| Price alerts | Built, quoting the venue; no web page yet. |

## Quick start

You need Node 24 or later. No keys are required.

```sh
nvm use
pnpm run setup
pnpm dev
```

Use `pnpm run setup`, not `pnpm setup`: the bare form is pnpm's own command for configuring your shell, and it won't set up Harbor.

Open the URL Vite prints. With no keys, the app runs on NEAR mainnet settings with execution off, and chat answers from a scripted model. To use a real model or your own endpoints, copy `.dev.vars.example` to `apps/worker/.dev.vars` and fill in what you need. Every value is optional.

Execution moves real funds on mainnet. It stays off unless you set `EXECUTION_ENABLED=true` and `ENABLED_WRITE_ADAPTERS=oneclick` in that ignored local file, and even then every deposit is signed in your own wallet.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | One dev server for the app and the Worker |
| `pnpm check` | Everything CI runs: Biome, typecheck, tests in workerd, build, knip |
| `pnpm --filter @harbor/worker db:generate` | Generate a migration from the schema |
| `pnpm --filter @harbor/worker db:migrate:local` | Apply migrations to the local D1 |
| `pnpm --filter @harbor/worker cron:local` | Tick the scheduled handler while `pnpm dev` runs |
| `HARBOR_LIVE_ONECLICK=1 pnpm --filter @harbor/adapters test` | Also fetch 1Click's token list and a verified dry quote |
| `HARBOR_LIVE_NEAR=1 pnpm --filter @harbor/near test` | Also read access keys from a mainnet RPC |

## Architecture

```
apps/
  web/             Vite, React 19, TanStack Router and Query: the app
  worker/          Cloudflare Worker: /api (Hono), D1, Durable Objects, scheduled()
    src/agent/         conversations, admission, tools; the model only proposes typed intents
    src/auth/          NEP-413 challenge, verification and sessions
    src/execution/     intent → quote → plan → approval, with every change recorded
    src/automations/   monitoring rules, leases and alerts
    src/markets/       dated research snapshot
packages/
  domain/          NEAR networks, account IDs, 1Click assets, bigint amounts, errors
  near/            NEP-413 verification, access-key check, approval digest
  adapters/        venue interface and the 1Click client
  policy/          fail-closed rule engine and the signed Policy schema
  jobs/            D1 leases and outbox
  agent-runtime/   turn limits and tool budget around Pi
  data/            research loaders with provenance
  ui/              shared components on Harbor's tokens
design/harbor/     tokens, logo
research/data/     dated snapshots
```

See [docs/architecture-decisions.md](docs/architecture-decisions.md) for why it is built this way and [AGENTS.md](AGENTS.md) for the safety rules.

## Documentation

The Vocs site in `apps/docs` documents this Harbor repository and its current product behavior.

```sh
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

Start with the [overview](apps/docs/src/pages/index.md) and [capability status](apps/docs/src/pages/status.md).

## License

[MIT](LICENSE). Third-party libraries and fonts are listed in [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).
