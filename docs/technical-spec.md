# Technical specification

What Harbor does with money, step by step, and where each rule lives.

## Accounts

- Sign-in: NEP-413 message with a single-use nonce, verified against a full-access key on chain (`apps/worker/src/auth`).
- Every plan, alert, policy and strategy belongs to the signed-in account; `requireSession` takes the account from the session, never from the request body.

## Policy (`packages/policy`, `apps/worker/src/policy`)

- `harbor.policy.v1`: allowed assets; per-asset spend limits (per action, per day, total) in raw units; the owner's own destinations; slippage; quote age; agent schedule; validity window of at most 90 days.
- Digest: SHA-256 over `harbor.policy.v1`, a NUL byte and the key-sorted policy JSON. The wallet signs a message that states the limits and the digest.
- States: `pending` → `active` → `frozen` / `revoked` / `superseded`. Only `pending` can be signed, once.
- `checkAction` returns `allow`, `warn` or `block`; `block` means only the owner can approve.

## Plans (`apps/worker/src/execution`)

1. Intent: assets from the verified registry, raw amount, optional recipient.
2. Dry quote from 1Click, signature verified.
3. Plan checks: sold asset on NEAR, recipient known and owned, quote fresh, minimum output valid, Harbor fee zero. A failure blocks the plan.
4. With execution on: token registrations present, then an executable quote for the owner's recipient and refund account, checked again.
5. Signed-policy check, spend counted from approved plans.
6. Digest over intent, quote, account, amounts, recipient, refund account, deposit address, memo, quote hash and deadline.

Statuses: `awaiting_review` → `awaiting_signature` → `submitted` → `confirming` → `confirmed`, or `blocked`, `expired`, `refunded`, `failed`, `outcome_unknown`. Every change is a `plan_events` row with its actor and reason.

## Deposit and settlement

- Signing request: `storage_deposit` (registration only) + `near_deposit` (when selling NEAR) + `ft_transfer` of exactly the planned amount to the deposit address, all to the token contract.
- `checkDeposit` (`packages/near/src/chain.ts`) accepts only that transaction, signed by the owner. A mismatch is refused; a failed transaction is `failed`; an unreadable one is kept and rechecked.
- Each cron tick: verified `/v0/status`; `REFUNDED` → `refunded`; `FAILED` → `failed`; `INCOMPLETE_DEPOSIT` → `outcome_unknown`; `SUCCESS` → `confirmed` only once `verifyDelivery` measures the delivery on chain. Two hours without a readable status or a verifiable delivery → `outcome_unknown`.

## Autonomy (`apps/worker/src/autopilot`)

- Strategies (recurring buys) run on the cron tick, only under an active, unexpired policy; each creates an intent the owner signs in one tap. Plans from them carry `source: autopilot`, so the policy's schedule applies.

## Agent (`apps/worker/src/agent`)

- Tools: `list_markets` (dated snapshot), `read_feed` (sample posts), `propose_intent`. All outside text arrives in an `<untrusted>` envelope. The model can only create intents; it cannot approve, sign or submit.
- Models: NEAR AI Cloud (attested models on NEAR AI's own TEE fleet only) or free OpenRouter models; scripted without a key.

## Gates

- `EXECUTION_ENABLED` and `ENABLED_WRITE_ADAPTERS` are both off in committed config. With them off, no executable quote is requested and no approval is recorded.
