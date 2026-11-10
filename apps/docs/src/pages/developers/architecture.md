# Architecture

## Request path

The React application in `apps/web` uses Vite, TanStack Router, and TanStack Query. Same-origin `/api` requests reach a Hono application inside the Cloudflare Worker. D1 stores application state; SQLite-backed Durable Objects handle conversations and admission control.

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | Product interface |
| `apps/worker` | Auth, API, execution plans, agent, research, scheduled monitoring |
| `apps/docs` | This Vocs documentation site; separate from the product runtime |
| `packages/domain` | Networks, assets, accounts, bigint amounts, errors |
| `packages/near` | NEP-413 verification, access-key checks, approval digest |
| `packages/adapters` | Venue contract and verified 1Click client |
| `packages/policy` | Fail-closed rules and versioned policy schema |
| `packages/jobs` | D1 leases and outbox |
| `packages/agent-runtime` | Pi integration, turn and tool budgets |
| `packages/data` | Research loading and provenance |
| `packages/ui` | Shared UI components |

## Financial data flow

The model proposes a typed intent. The server resolves canonical assets, parses amounts, asks a venue for a quote, evaluates policy rules, and stores the resulting plan and audit events. Model prose never becomes financial state.

Amounts use bigints in code and canonical decimal TEXT in D1. Never use floating-point arithmetic for balances or raw token amounts. Symbols are presentation inputs, not globally unique token identifiers.

## Runtime boundaries

- `ConversationAgent` stores conversation and run state.
- `AgentAdmission` limits concurrent and guest runs.
- Scheduled monitoring uses durable D1 jobs and leases.
- Mainnet and testnet have separate bindings; mainnet alone has the current 1Click swap venue.
- The docs workspace has no Worker binding, wallet integration, or deployment command.

Read the existing [architecture decisions](https://github.com/alycz/harbor/blob/main/docs/architecture-decisions.md) for design rationale. They remain the repository's decision record.

Sources: [Worker entry](https://github.com/alycz/harbor/blob/main/apps/worker/src/index.ts), [app router](https://github.com/alycz/harbor/blob/main/apps/worker/src/app.ts), [database schema](https://github.com/alycz/harbor/blob/main/apps/worker/src/db/schema.ts).
