# Contributing and troubleshooting

## Repository workflow

Read [AGENTS.md](https://github.com/alycz/harbor/blob/main/AGENTS.md) first. Work in an isolated branch, keep changes reviewable, and use the exact dependency versions in the pnpm catalog. Do not deploy or run remote migrations without a separate request.

```sh
pnpm run setup
pnpm check
```

CI also checks generated Worker types and a deployment dry run:

```sh
pnpm --filter @harbor/worker types:check
pnpm --filter @harbor/web exec wrangler deploy --dry-run
```

A dry run is a build validation, not a deployment. Worker tests execute in workerd. Live-service tests are opt-in, not part of ordinary offline tests:

```sh
HARBOR_LIVE_ONECLICK=1 pnpm --filter @harbor/adapters test
HARBOR_LIVE_NEAR=1 pnpm --filter @harbor/near test
```

These opt-ins contact external services; do not claim to have run them unless you actually did.

## Editing documentation

1. Read the implementation and tests for the feature.
2. Edit the corresponding Markdown page in `apps/docs/src/pages`.
3. Update the sidebar in `apps/docs/vocs.config.ts` when routes change.
4. Run `pnpm --filter @harbor/docs test`, `pnpm docs:build`, and `pnpm check`.
5. Preview the built site and verify navigation, search, code blocks, and both themes.

Keep “implemented,” “tested with fixtures,” and “planned” separate. Source links point to Harbor, and examples must never contain real secrets or deposit instructions. If code and README disagree, identify the discrepancy explicitly rather than copying an outdated claim.

## Troubleshooting

| Symptom | First check |
| --- | --- |
| Setup does not initialize Harbor | Use `pnpm run setup`, not `pnpm setup` |
| Node compatibility failure | Use `.nvmrc`; minimum is Node 24 |
| Chat always gives the same answer | Scripted fallback is expected without the optional model key |
| No research or yield results | Inspect snapshot freshness, sources, and filters |
| No swap quote on testnet | Current 1Click venue is mainnet-only |
| Approval returns execution disabled | Expected default; missing execution implementation is not fixed by flags |
| Conflict during chat | The conversation may already be answering |
| Rate limit or capacity error | Honor Retry-After; avoid repeated clicks |
| D1 errors locally | Rerun local migrations and check generated Worker types |
| Docs build errors after dependency changes | Reinstall from the lockfile and verify supported Node version |

For failures, report the command, relevant public error, request ID, and reproducible steps. Redact secrets and avoid publishing account-sensitive information.
