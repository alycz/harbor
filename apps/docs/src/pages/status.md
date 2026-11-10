# Current capabilities

These docs were checked against Harbor's source, not just the README's product description. Features listed as planned are not promises of availability.

| Area | Implemented behavior | Limit |
| --- | --- | --- |
| Wallet sign-in | NEP-413 challenge, verification, full-access public-key check, cookie session | Recorded-RPC tests are not proof of a real-wallet end-to-end test |
| Chat | Durable Object conversation, streamed events, research and swap-proposal tools | Scripted fallback without a model key; tools cannot submit funds |
| Research and Earn | Dated snapshot, filters, provenance | Not live rates, executable yield deposits, or guaranteed returns |
| Mainnet swaps | 1Click dry-quote venue is wired into `executionDeps` | No 1Click testnet venue; no deposit submission |
| Plans | Intent, quote, fail-closed checks, digest, idempotent plan creation, review | Default configuration stops at review; approval only records review |
| Price alerts | Draft/revise/activate/pause rules, scheduled checks, alerts | Read-only monitoring, not recurring trades |
| Policy schema | Versioned budgets, asset and destination limits, schedule and expiry | Policy signing and autonomous enforcement are not implemented |
| Settlement | State and recovery scaffolding | Verified delivery and settlement receipt flow are not implemented |

:::note[Source takes precedence]
The README currently says 1Click is not wired as the swap venue. The current `executionDeps` source does wire `oneClickVenue` on mainnet. These docs follow the code and explicitly retain the execution limitations.
:::

## Planned, not shipped

The vision includes signed strategy policies, bounded agent signing, deposit verification, independent delivery checks, and a freeze control for autonomous execution. Do not treat a suggested policy, a stored status field, or a future safety requirement as a completed user flow.

The poisoned-post demonstration describes the intended defense: outside text must never override user limits. Untrusted text is treated as data today; destination enforcement needs the future signed-policy enforcement path.

Sources: [README status](https://github.com/alycz/harbor/blob/main/README.md), [venue wiring](https://github.com/alycz/harbor/blob/main/apps/worker/src/execution/store.ts), [approval implementation](https://github.com/alycz/harbor/blob/main/apps/worker/src/execution/lifecycle.ts), [policy schema](https://github.com/alycz/harbor/blob/main/packages/policy/src/policy.ts).
