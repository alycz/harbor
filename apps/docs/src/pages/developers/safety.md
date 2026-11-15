# Safety and policies

## Non-negotiable boundaries

Harbor never holds the user's seed phrase or private full-access key. The model proposes typed intents only. External feeds, posts, pages, and model-visible text are data, never authority to change user instructions.

A financial submission requires both `EXECUTION_ENABLED` and an adapter in `ENABLED_WRITE_ADAPTERS`. Both are off in committed configuration, so a fresh checkout never requests an executable quote.

The agent signs only through a bounded mechanism: the Leash contract, which pays a 1Click deposit only inside the owner's on-chain limits, through an `execute`-only function-call key held by a private signer Worker. The contract is deployed at `harbor-leash.near` and is not audited; each dispatch still needs the owner's approval of that quote. Everything else is signed by the user.

## Fail-closed rule engine

Rules return structured results. Exceptions or malformed results block rather than silently passing. Plan checks cover the origin and recipient being the owner's own, quote freshness, minimum output and Harbor's fee. The owner's signed policy is then checked separately: spend limits, allowed assets, destinations, slippage, schedule and expiry.

## The signed policy

`harbor.policy.v1` includes:

- Network and owner.
- Allowed assets and destination chain/address pairs.
- Budget, optional per-action and daily caps.
- Slippage, optional price-impact warning, quote maximum age.
- Once or interval schedule, valid-from time, and expiry.

Caps must refer to allowed assets. Assets must be unique, and expiry must follow the start. Null optional caps are disabled, not zero. Suggested values (50 bps slippage, 100 bps warning, 30-second quote age, seven-day expiry) are labeled suggested and do not become signed authority on load.

A policy takes effect only once the owner signs its digest with a full-access key (NEP-413). A plan that names a destination the owner did not sign is blocked. A signed policy can be frozen or revoked at once.

## Settlement requirements

Before any deposit is accepted, its decoded receiver and amount must exactly match the plan. Unknown 1Click status does not prove non-execution. Refund is distinct from success. Delivery must be checked independently before settlement is trusted.

Sources: [repository safety rules](https://github.com/alycz/harbor/blob/main/AGENTS.md), [policy engine](https://github.com/alycz/harbor/blob/main/packages/policy/src/engine.ts), [policy schema](https://github.com/alycz/harbor/blob/main/packages/policy/src/policy.ts), [policy checks](https://github.com/alycz/harbor/blob/main/packages/policy/src/check.ts), [Leash contract](https://github.com/alycz/harbor/blob/main/contracts/leash/src/lib.rs).
