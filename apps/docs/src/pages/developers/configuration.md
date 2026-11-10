# Configuration

Local optional values belong in `apps/worker/.dev.vars` (or `.dev.vars.testnet`). These ignored files are server-only. Never put credentials in frontend variables, documentation examples, or commits.

| Variable | Default / behavior |
| --- | --- |
| `NEAR_NETWORK` | `mainnet`; testnet environment uses `testnet` |
| `EXECUTION_ENABLED` | `false`; retain for ordinary local work |
| `ENABLED_WRITE_ADAPTERS` | Empty comma-separated allowlist |
| `OPENROUTER_API_KEY` | Optional; absent or empty gives scripted chat |
| `PI_PROVIDER` | `openrouter`; `faux` is for scripted demos/tests |
| `PI_MODEL_ID` | `openrouter/free`; model validation requires a free model |
| `PI_FAUX_SCRIPT` | Required nonempty script when using the faux provider |
| `ONE_CLICK_JWT` | Optional partner JWT; unauthenticated quotes carry default protocol fee |
| `NEAR_RPC_URL` | Optional read endpoint; otherwise network public RPC |
| `AGENT_GUEST_TURNS_PER_15_MIN` | `5` |
| `AGENT_MAX_ACTIVE_RUNS` | `4` |

Invalid configuration reports the failed variable names, not values. Empty optional template values are treated as unset.

## Networks and local data

Mainnet is the default read network. 1Click is wired only for mainnet; changing to testnet does not create a testnet swap venue. D1 bindings separate the two environments. The committed local database IDs are placeholders, not deployment instructions.

```sh
pnpm --filter @harbor/worker db:generate
pnpm --filter @harbor/worker db:migrate:local
```

The first command generates migrations; the second applies them locally. Neither is permission to apply migrations remotely.

## Documentation configuration

`apps/docs/vocs.config.ts` owns site title, theme, navigation, and repository link. No production domain is assumed. Set a verified `baseUrl` only when a documentation hosting destination is chosen; Vocs uses it for absolute sitemap URLs. Deployment is intentionally not configured here.

Sources: [decoder](https://github.com/alycz/harbor/blob/main/apps/worker/src/config.ts), [Wrangler configuration](https://github.com/alycz/harbor/blob/main/apps/worker/wrangler.jsonc), [example variables](https://github.com/alycz/harbor/blob/main/.dev.vars.example).
