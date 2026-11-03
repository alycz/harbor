# Architecture decisions

## NEAR mainnet is the only execution network

1Click has no testnet, so swaps and deposits only exist on mainnet. Testnet stays for wallet sign-in and contract tests. Each network has its own D1 database, and every row still names its network, so a binding pointed at the wrong database cannot mix them.

Two gates guard execution, `EXECUTION_ENABLED` and `ENABLED_WRITE_ADAPTERS`, and both are off in committed config.

## Our own 1Click client

`@harbor/adapters` talks to 1Click directly instead of through the provider SDK. Responses are size and depth bounded before parsing, validated with zod, and a quote is only trusted once its signature verifies against 1Click's manager key using WebCrypto. An executable quote must be asked for explicitly.

## Sign-in is NEP-413 plus a full-access key check

The wallet signs a one-time message naming this site, and the Worker checks three things:

1. The nonce is unused, unexpired, and was issued to this browser for this account. It is consumed before anything else, so one challenge gets one attempt.
2. The ed25519 signature covers exactly the message, nonce and recipient the server expects. The recipient is the request's host, so a signature made for another site never verifies here.
3. The chain says the key is a **full-access** key on that account. Function-call keys get handed to apps, so they prove nothing about who owns the account.

An unreachable RPC answers 503, never "bad signature": a failure to ask says nothing about the account.

Only a hash of the session token is stored. The token itself lives in an `HttpOnly`, `SameSite=Lax` cookie.

## Plans record what the provider says, and don't simply believe it

`plans` keeps the deposit address, the transaction hash and 1Click's last status separately. `confirmed` needs the delivery checked independently (`delivery_verified_at_ms`). `refunded` and `outcome_unknown` are their own statuses, because a refund is not a success and an unknown status never proves the action didn't execute.

`deposit_memo` is empty rather than NULL when a quote has no memo. SQLite's unique index treats NULLs as distinct, and one deposit address must belong to one plan.

## Pi runs the agent, inside workerd

The agent runs on `pi-agent-core` in a Durable Object per conversation. These compatibility tests are the gate for upgrading Pi: `pi-agent-core`, `pi-ai` and `pi-mcp` must load and run in workerd with the production compatibility date. `pi-coding-agent` cannot load in workerd, because its undici dependency needs Node internals at import time, so the Worker does not use it. Its tests record that as an expected failure and will flag a release that fixes it.

The approved tool list is checked at startup in both directions, so a tool cannot be added by accident. The model can only create intents and quotes through `propose_intent`; it cannot approve, sign or submit.

## With no keys, everything still runs

A fresh checkout needs no accounts. Without a model key the agent answers from a scripted model. Without `NEAR_RPC_URL` reads use a public endpoint. Without `ONE_CLICK_JWT` 1Click quotes still work and carry the default protocol fee. No secret is declared required.

## Open: how the agent is held to the policy

Harbor runs `@harbor/policy` on the server in every case. To add enforcement outside our server, one of these gets chosen by a time-boxed spike:

- **Intents Agent API**, if it is live on mainnet and really rejects an out-of-policy action.
- **A small `leash` contract**: each strategy gets a sub-account holding only its budget, the agent gets a function-call key restricted to the contract's `execute` method, and the contract enforces allowed assets, caps, expiry and freeze.
- **Fallback**: the policy is enforced on our server, and the user taps to approve queued plans.
