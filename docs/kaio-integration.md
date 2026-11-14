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
