# Current capabilities

These docs were checked against Harbor's source, not just its product description. "Tested" means automated tests in workerd with recorded or simulated provider and chain answers; "live" means checked against the real service.

| Area | Implemented behavior | Limit |
| --- | --- | --- |
| Wallet sign-in | NEP-413 challenge, verification, full-access key check, cookie session | Not yet run end to end with a real wallet |
| Account isolation | Plans, alerts, policies and strategies belong to the signed-in account; another account's record reads as not found | — |
| Signed policy | Per-asset spend limits (per action, per day, total), allowed assets, own destinations, slippage, quote age, agent schedule and expiry, signed with NEP-413 and a full-access key; freeze and revoke at once | Signing needs a real wallet; tested with an independent NEP-413 signer |
| Plan checks | Origin on NEAR, recipient known and owned, quote fresh, minimum output, zero Harbor fee; then the signed policy check | A failed signed-policy check leaves the plan for the owner's own approval |
| Mainnet swaps | Executable 1Click quote made out to the owner's recipient and refund account; one wallet transaction (register, wrap, transfer); deposit accepted only after decoding to exactly the planned transfer | Executable quotes checked live; a real signed deposit has not been made yet |
| Settlement | Verified 1Click status; `confirmed` only after the delivery is measured on the destination chain (NEAR balance, or EVM transfer receipt); refunds stay refunds; unknown stays unknown | Solana deliveries cannot be verified and stay unconfirmed |
| Autonomy | Recurring buys queued by the agent only under an active policy, each still checked against it, signed by the owner in one tap | The leash contract (`contracts/leash`) is built and tested but not deployed, and the Worker does not call it yet |
| Chat | Durable Object conversation; research, sample-feed and swap-proposal tools; outside text is wrapped as untrusted data | Scripted fallback without a model key |
| Models | OpenRouter free models, or NEAR AI Cloud with an allowlist of attested models on NEAR AI's own TEE fleet | Per-response signature verification is not shown yet |
| Research and Earn | Dated snapshot with source and capture time shown | Not live rates; Earn has no deposit flow yet |
| Price alerts | Draft, activate, pause; scheduled checks against a dry venue quote; alerts | Monitoring only; no web page for alerts yet |

## The poisoned-post demo

The sample feed holds a post telling agents to send funds to `migrate-harbor.near`. A test runs the real agent loop with a model scripted to obey it: the proposal it creates is blocked when the owner reviews it (`DESTINATION_NOT_OWN`, and `DESTINATION_NOT_SIGNED` against the policy), and no executable quote, deposit address or deposit notice is ever created.

Sources: [plan checks](https://github.com/alycz/harbor/blob/main/apps/worker/src/execution/swap.ts), [policy rules](https://github.com/alycz/harbor/blob/main/packages/policy/src/check.ts), [settlement](https://github.com/alycz/harbor/blob/main/apps/worker/src/execution/settlement.ts), [poisoned-post test](https://github.com/alycz/harbor/blob/main/apps/worker/test/poisoned.test.ts).
