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

## A policy is a signed message, and the agent queues, the owner signs

The owner signs their policy with NEP-413, like sign-in: no transaction, no gas, and the Worker checks the signature and that the key is a full-access key on the account. Caps are per asset in raw units, so no price feed decides whether a limit holds. Freezing needs no signature, because it only narrows what the agent may do; only signing a new revision undoes it.

Every plan runs two checks. The plan's own checks (the recipient is the owner's, the quote is valid, the fee is zero) block it for everyone. The signed policy decides whether the agent could have acted on its own; outside it, only the owner can approve. The destination check sits in the first group on purpose: no approval sends funds to an address the owner did not sign.

The agent acts on its own by queuing: a due strategy creates an action only under an active, unfrozen, unexpired policy, and the owner signs it in one tap. The spike in [docs/spikes/autonomy.md](spikes/autonomy.md) found no live Intents agent API, and designs a `leash` contract that would let the agent sign within limits enforced on chain. Until one is deployed, nothing signs for the owner. Everything autonomous lives under `apps/worker/src/autopilot/`.

## A deposit is checked on chain, and so is the delivery

The wallet signs one transaction Harbor builds from its own records: register the deposit address on the token, wrap NEAR when NEAR is sold, transfer exactly the planned amount. Harbor accepts it only after NEAR shows exactly that transaction, signed by the owner. 1Click quotes only for accounts registered on the tokens involved, so a first swap may ask for that refundable storage deposit first.

`confirmed` needs the delivery measured on the destination chain: the NEAR recipient's balance rose by at least the minimum since approval, or an EVM receipt carries a transfer of at least the minimum to the recipient. A deposit hash is stored before it is checked, so a deposit is never lost while an RPC is down; one that lands after its approval window still counts.
