# API reference

This is the current internal application API, not a stable public SDK contract. All paths below are relative to `/api`. Do not assume session protection or account-level authorization merely because an endpoint accepts an account ID. Verify route middleware before exposing an integration.

Bodies are JSON, capped at 64 KiB. Errors use `{ ok: false, error: { code, message, requestId } }`; rate and capacity responses may add `retryAfterSeconds` and a `Retry-After` header.

## Health and research

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/health` | Network, execution setting, D1 health, request ID; 503 if unhealthy |
| GET | `/markets/chains` | Dated chain observations and sources |
| GET | `/markets/yields` | Filters: `chain`, `symbol`, `stablecoin`, `limit` (1–200; default 50) |

```sh
curl http://localhost:5173/api/health
curl 'http://localhost:5173/api/markets/yields?chain=Near&limit=10'
```

Replace the origin with the local URL Vite prints. Research responses are not live executable quotes.

## Authentication

| Method | Path | Body / result |
| --- | --- | --- |
| POST | `/auth/challenge` | `{ accountId }`; returns nonce, message, recipient, expiry and sets challenge cookie |
| POST | `/auth/verify` | `{ accountId, publicKey, signature, nonce }`; verifies wallet message and sets session cookie |
| GET | `/auth/session` | `{ session }`; no-store |
| POST | `/auth/logout` | Ends session and clears cookie |

Use the browser wallet flow. Do not sign with a private key in a script or include private keys in requests.

## Intents and plans

| Method | Path | Body / behavior |
| --- | --- | --- |
| GET | `/assets` | Configured network asset registry |
| POST | `/intents` | `{ kind: "swap", sellAsset, buyAsset, sellAmount }`; amount is a decimal string |
| GET | `/intents/:id` | Read intent |
| POST | `/intents/:id/compare` | Fresh comparison; mainnet uses a verified dry quote |
| POST | `/plans` | `{ intentId, quoteId, accountId }`; requires `Idempotency-Key` |
| GET | `/plans?account=...` | Account activity for plans that reached the network |
| GET | `/plans/:id` | Plan and review data |
| POST | `/plans/:id/approve` | `{ digest }`; records review only, gated and expiry-checked |

IDs are UUIDs. An idempotency key is 8–128 characters from letters, digits, dot, underscore, colon, or hyphen. The approval digest is 64 lowercase hexadecimal characters. Do not retry with changed content under the same key.

## Conversations

Paths are relative to `/api/agent`.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/conversations` | Returns a conversation UUID |
| GET | `/conversations/:id` | Transcript |
| POST | `/conversations/:id/messages` | `{ messageId, text, researchOnly?, history? }` |
| GET | `/conversations/:id/runs/:runId/events` | SSE; `Last-Event-ID` takes precedence over `after` |
| POST | `/conversations/:id/runs/:runId/abort` | Stops a run |

Text is 1–4,000 trimmed characters. Optional history allows at most 12 user/assistant entries, at most 12,000 characters each and 48,000 combined. Preserve message IDs when retrying an admission request rather than accidentally starting duplicate work.

## Monitoring

Paths are relative to `/api/automations`.

| Method | Path | Body / behavior |
| --- | --- | --- |
| GET | `/` | List monitors |
| POST | `/` | `{ kind: "price_alert", config, name?, account? }` |
| POST | `/preview` | `{ config }`; evaluate without saving or firing |
| GET | `/:id` | Read saved monitor |
| POST | `/:id/revisions` | `{ expectedRevision, config, name? }` |
| POST | `/:id/activate` | `{ revision, configHash }` |
| POST | `/:id/pause` | Pause |
| POST | `/:id/test` | Evaluate saved configuration without recording or alerting |
| DELETE | `/:id` | Delete monitor |
| POST | `/alerts/:id/acknowledge` | Acknowledge alert |

See [price alerts](/guides/price-alerts) for configuration semantics. These routes cannot trade.

## Error handling

`INVALID_REQUEST` → 400; `UNAUTHORIZED` → 401; `FORBIDDEN` → 403; `NOT_FOUND` → 404; `CONFLICT` and `EXECUTION_DISABLED` → 409; `PAYLOAD_TOO_LARGE` → 413; `RATE_LIMITED` → 429; `UNAVAILABLE` → 503; `INTERNAL` → 500.

Retain the request ID for debugging. An API failure is not evidence that a future external financial submission did not execute.

Source: [router and error envelope](https://github.com/alycz/harbor/blob/main/apps/worker/src/app.ts), plus the `routes.ts` files under `auth`, `agent`, `execution`, `markets`, and `automations` in that repository.
