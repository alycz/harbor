# Configuration

Local optional values belong in `apps/worker/.dev.vars` (or `.dev.vars.testnet`). These ignored files are server-only. Never put credentials in frontend variables, documentation examples, or commits.

| Variable | Default / behavior |
| --- | --- |
| `NEAR_NETWORK` | `mainnet`; testnet environment uses `testnet` |
| `EXECUTION_ENABLED` | `false`; retain for ordinary local work |
| `ENABLED_WRITE_ADAPTERS` | Empty comma-separated allowlist |
| `OPENROUTER_API_KEY` | Optional; absent or empty gives scripted chat |
| `PI_PROVIDER` | `openrouter`; `faux` is for scripted demos/tests |
| `PI_MODEL_ID` | `z-ai/glm-5.3-flash`; model validation allows free OpenRouter models and a short paid list (GLM 5.3 and GLM 5.3 Flash) |
| `PI_FAUX_SCRIPT` | Required nonempty script when using the faux provider |
| `ONE_CLICK_JWT` | Optional partner JWT; unauthenticated quotes carry default protocol fee |
| `NEAR_RPC_URL` | Optional read endpoint; otherwise network public RPC |
| `AGENT_GUEST_TURNS_PER_15_MIN` | `30`: chat messages per 15 minutes for a visitor without a wallet, counted per IP |
| `AGENT_ACCOUNT_TURNS_PER_15_MIN` | `100`: the same for a signed-in wallet, counted per account; defaults to the guest limit |
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

## Generated deployment configuration

After building the app and docs, select the mainnet write integrations explicitly:

```sh
node scripts/prepare-deployment.mjs mainnet DATABASE_ID --enable-execution --write-adapters=oneclick,rhea-lending
```

This generates a local configuration only; it does not deploy or apply migrations. With `--enable-execution`, the generated file enables execution for the selected adapters when subsequently deployed.
`EXECUTION_ENABLED` remains `false` unless `--enable-execution` is explicitly added.
The adapter selection is retained while execution is off, so both gates remain independent.
When `--write-adapters` is omitted, the selection in the built configuration is kept. The committed `apps/worker/wrangler.jsonc` selects none and keeps execution off, so local development and tests never move funds; a production deploy must name its adapters.
An empty `--write-adapters=` clears the selection; execution cannot be enabled with an empty list.
Only `oneclick`, `rhea-lending`, and `templar` are accepted. KAIO is not a supported write adapter.
These adapters are mainnet-only; testnet configurations remain execution-disabled with an empty list.
Changing either gate does not establish that migrations, protocol registration, supported-market verification,
wallet approval, balances, or settlement verification are ready. Those requirements still apply.


## Enable Templar in a teammate deployment

A valid market can return `borrowingEnabled: false` when either global execution is disabled or the `templar` write adapter is absent. A successful market read is not a borrowing permission. The response's `borrowingDisabledReason` distinguishes those settings.

After building the audited revision (including the Templar approval/receipt fixes), prepare an explicitly enabled mainnet artifact:

```sh
pnpm build
pnpm docs:build
node scripts/prepare-deployment.mjs mainnet "$HARBOR_D1_ID" --enable-templar
```

This local preparation opts into both `EXECUTION_ENABLED=true` and `templar` in `ENABLED_WRITE_ADAPTERS`. It preserves other adapters selected in the built config or supplied using `--write-adapters=...`. It does not inspect deployed settings: include the existing deployed adapter selection explicitly if it differs from the built config. It does not deploy or run migrations. Testnet rejects this option. Checked-in defaults remain disabled.

The teammate must then apply required migrations and deploy that exact generated artifact using the project's normal deployment process. Do not subsequently run the default `deploy:mainnet` command: it regenerates a disabled artifact without these explicit options. After deployment, read `/api/health` and `/api/templar/markets/<active-market>` to verify the switch and adapter are active. No wallet transaction is needed for that check.
