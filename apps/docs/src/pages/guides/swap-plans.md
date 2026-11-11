# Swap plans

## The flow

1. Choose two different supported assets and a decimal amount. Anyone can get a live quote; a plan needs a signed-in wallet.
2. Harbor resolves both assets from its verified registry and records an intent.
3. On mainnet, a verified 1Click **dry quote** shows the price. A dry quote creates no deposit address.
4. **Review swap.** Harbor runs the plan's own checks. With execution on, it then asks 1Click for an **executable quote** made out to your own recipient and refund account, and runs your signed policy over it.
5. **Approve and sign in wallet.** Approval binds the digest you reviewed and records the recipient's starting balance. Your wallet signs one transaction: register the deposit address on the token, wrap NEAR if you sell NEAR, and transfer exactly the planned amount.
6. Harbor accepts the deposit only after NEAR shows a transaction signed by you, sent to the token, carrying only those actions and transferring exactly the planned amount to the deposit address.
7. Each cron tick follows 1Click's verified status. **Confirmed** needs the delivery measured on the destination chain itself.

The first swap of a token may ask for a one-time setup: 1Click only quotes for accounts registered on the tokens involved, so your wallet signs a refundable storage deposit first.

## What the review checks

- **Plan checks, which no approval overrides:** the sold asset is on NEAR; the recipient is your own (your NEAR account, or an address you signed in your policy); the quote is still valid; the minimum output is positive and no more than the output; Harbor's fee is zero.
- **Your signed policy:** allowed assets, per-action, daily and total spend for the sold asset, slippage, quote age, expiry, freeze, and for the agent its schedule. Outside the policy, only you can approve the plan.

## How a swap can end

- **Confirmed:** delivered and verified on chain.
- **Refunded:** 1Click returned the deposit. A refund is never a success.
- **Failed:** the deposit failed on chain (nothing moved), or 1Click reports a failure.
- **Outcome unknown:** 1Click stopped answering, saw less than planned, or reported success that could not be verified. Unknown never means "did not happen".
- **Expired:** the approval window closed before any deposit. A deposit that still lands is accepted.

Sources: [executable quotes](https://github.com/alycz/harbor/blob/main/packages/adapters/src/oneclick/venue.ts), [plan checks](https://github.com/alycz/harbor/blob/main/apps/worker/src/execution/swap.ts), [deposit check](https://github.com/alycz/harbor/blob/main/packages/near/src/chain.ts), [settlement](https://github.com/alycz/harbor/blob/main/apps/worker/src/execution/settlement.ts).
