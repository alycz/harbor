# KAIO subscription API integration

`@harbor/adapters/kaio/client` implements the actual documented investor subscription
request and order-query endpoints, not a simulated transaction. It is not yet wired
into Harbor's UI/execution registry and is not enabled for users.

## Required before enabling

- Confirm the deployed KAIO API base/version with KAIO. The public reference uses
  localhost examples; the documented production Swagger host returned 520 during inspection.
- An onboarded, eligible investor and investor-scoped JWT obtained through KAIO's
  login/MFA flow. Do not store a shared investor token in Harbor configuration.
- A provider-issued instrument ID, permitted subscription amount and dealing window.
- An authenticated explicit approval flow, order persistence and reconciliation.
- Agreement signing and KAIO admin locking/settlement. A successful create request
  is only an order request, never proof that fund shares were minted.

No login/password capture, dealer impersonation, agreement auto-signing, direct mint,
write-enablement change, or automatic retry is implemented. No live requests were made.

## Official references inspected

- https://docs.kaio.xyz/guide-to-using-kaio/understanding-projects
- https://docs.kaio.xyz/guide-to-using-kaio/kaio-platform/investor/investor
- https://docs.kaio.xyz/guide-to-using-kaio/kaio-platform/investor/investor-how-tos
- https://documenter.getpostman.com/view/26092879/2s93Xu36Mm

The Postman reference documents POST `/api/v1/orderbook/subscription/order` with
`instrumentId` and `amount`. `investorId` is required for dealers, not this investor
client. Readback uses GET `/api/v1/orderbook/order` and `/api/v1/orderbook/order/:orderId`.
The complete flow requires create, confirm with an agreement, then admin locking and
settlement. Confirmation is intentionally not auto-triggered by this client.

## Authenticated server workflow seam

`@harbor/adapters/kaio/workflow` adds an investor-bound subscription coordinator.
The server must provide a verified Harbor-account → KAIO-investor session resolver,
provider-configured instrument eligibility checks, and durable `KaioOrderStore`.
Its store contract requires atomic insert-if-absent per account/attempt UUID. Reusing
an attempt never repeats the provider POST; conflicting payloads are rejected.
Claiming precedes submission, so a crash or lost response requires reconciliation,
not another order. A received response is not settlement or mint success.

This is **not connected to Harbor routes/UI and not a completed persistence backend**.
Harbor's existing NEAR wallet sign-in does not prove ownership of a KAIO investor
account. We intentionally do not ask for pasted JWTs, share one investor credential,
or invent an OAuth exchange. Before exposing a submit button, implement the provider-
approved investor authentication/linking flow, durable store, request/CSRF checks,
and explicit user approval. No new tables or migrations have been applied.
