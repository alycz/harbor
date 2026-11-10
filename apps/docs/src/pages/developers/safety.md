# Safety and policies

## Non-negotiable boundaries

Harbor never holds the user's seed phrase or private full-access key. The model proposes typed intents only. External feeds, posts, pages, and model-visible text are data, never authority to change user instructions.

A financial submission must require both `EXECUTION_ENABLED` and an adapter in `ENABLED_WRITE_ADAPTERS`. Both are off in committed configuration. Their existence is not evidence that submission is implemented.

Future bounded agent signing must use a sub-account budget or contract-enforced policy. Without that mechanism, signing stays with the user.

## Fail-closed rule engine

Rules return structured results. Exceptions or malformed results block rather than silently passing. Current swap checks cover freshness, minimum output, price-impact warnings, and Harbor's fee. This is different from enforcing a user's complete signed strategy policy.

## Policy schema, not active authority

`harbor.policy.v1` includes:

- Network and owner.
- Allowed assets and destination chain/address pairs.
- Budget, optional per-action and daily caps.
- Slippage, optional price-impact warning, quote maximum age.
- Once or interval schedule, valid-from time, and expiry.

Caps must refer to allowed assets. Assets must be unique, and expiry must follow the start. Null optional caps are disabled, not zero. Suggested values (50 bps slippage, 100 bps warning, 30-second quote age, seven-day expiry) are labeled suggested and do not become signed authority on load.

Policy signing and enforcement are planned. Do not describe destination blocking or autonomous budget enforcement as shipped merely because schema fields exist.

## Settlement requirements

Before any future deposit is accepted, its decoded receiver and amount must exactly match the plan. Unknown 1Click status does not prove non-execution. Refund is distinct from success. Delivery must be checked independently before settlement is trusted.

No deployment, remote migration, or Cloudflare account changes belong in routine documentation work.

Sources: [repository safety rules](https://github.com/alycz/harbor/blob/main/AGENTS.md), [policy engine](https://github.com/alycz/harbor/blob/main/packages/policy/src/engine.ts), [policy schema](https://github.com/alycz/harbor/blob/main/packages/policy/src/policy.ts).
