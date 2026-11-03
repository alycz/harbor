# Harbor

A cross-chain DeFi agent that acts on its own, but only inside limits you signed.

- You ask in plain language.
- Harbor compares real venues across chains, proposes a plan, and you sign one policy: budget, allowed assets, your own addresses only, schedule and expiry.
- The agent executes through [NEAR Intents](https://docs.near-intents.org) and records a verified receipt for each action.
- Anything outside the policy comes back to you for approval, and you can freeze the agent at any time.

## The demo

A poisoned post tells the agent to send all funds to another account. The agent reads it, but outside text is data, never an instruction. The destination isn't one you signed, so the policy returns `block`, Harbor asks you for approval, and nothing is submitted.

## Status

Harbor is being built for the NEAR hackathon. This is what runs today.

| Area | State |
|---|---|
| Wallet sign-in (NEP-413 through NEAR Connect, full-access key check) | Built and tested against recorded RPC responses. Not yet tried with a real wallet. |
| Fail-closed policy engine and signed `Policy` schema | Engine runs on every plan. The schema exists; signing and enforcing a policy does not yet. |
| 1Click client with quote-signature verification | Built, checked against a live signed quote. Not yet wired in as the swap venue. |
| Plans: intent, quote, policy check, approval digest, audit trail | Built. Execution is off by default, so plans stop at review. |
| Agent chat with research and swap proposal tools | Built. Scripted replies until you add a model key. |
| Research and Earn pages | Built. The committed snapshot is empty until a collector fills it. |
| Deposits, settlement receipts and autonomous execution | Not built yet. |
| Poisoned-post block | The agent treats outside text as data today. The destination block arrives with policy enforcement. |

## Quick start

You need Node 24 or later. No keys are required.

```sh
nvm use
pnpm run setup
pnpm dev
```

Use `pnpm run setup`, not `pnpm setup`: the bare form is pnpm's own command for configuring your shell, and it won't set up Harbor.

Open the URL Vite prints. With no keys, the app runs on NEAR mainnet settings with execution off, and chat answers from a scripted model. To use a real model or your own endpoints, copy `.dev.vars.example` to `apps/worker/.dev.vars` and fill in what you need. Every value is optional.

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

## License

[MIT](LICENSE). Third-party libraries and fonts are listed in [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).
