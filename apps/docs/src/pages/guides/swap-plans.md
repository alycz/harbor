# Swap plans

## Current flow

1. Choose distinct supported assets and a positive decimal sell amount.
2. Harbor resolves assets from its configured registry and stores an intent.
3. On mainnet, the venue requests a verified 1Click **dry quote**.
4. Harbor records the quote and builds a plan with policy results and an approval digest.
5. Review the plan. In committed configuration, execution remains disabled.

A dry quote creates no deposit address. Never send funds to the stand-in addresses used for dry-quote requests. They only satisfy quote address formatting and are not deposit instructions.

## What the review checks

- Quote age: the local quote window is 30 seconds.
- Slippage: the current plan uses 50 basis points (0.5%).
- Minimum output: positive and no greater than the quoted output.
- Price impact: unknown impact or impact at least 100 basis points (1%) generates a warning. The 1Click venue currently reports impact as unknown.
- Harbor execution fee: the plan requires zero Harbor fee. This does not mean third-party routing, protocol, or network costs are zero.

The digest binds the intent, quote, network, account, canonical assets, input amount, minimum output, and slippage. A different digest cannot approve the existing plan.

## Approval is not settlement

The approval route requires both execution enablement and an allowlisted adapter. It rechecks quote expiry and transitions to `awaiting_signature`; it does not sign or submit a transaction. There is no completed deposit or independently verified settlement workflow in this version.

Do not enable flags as a substitute for implementing and validating these missing steps. Unknown provider status is not proof of failure, and a refund is not a successful swap.

## Common outcomes

- **No venue on testnet:** 1Click has no testnet venue here.
- **No route or bridge minimum:** change the pair or amount only after reviewing the refusal.
- **Expired quote:** request a fresh comparison and review a new plan.
- **Execution disabled:** expected in the default configuration.

Sources: [dry-quote adapter](https://github.com/alycz/harbor/blob/main/packages/adapters/src/oneclick/venue.ts), [swap rules](https://github.com/alycz/harbor/blob/main/apps/worker/src/execution/swap.ts), [lifecycle](https://github.com/alycz/harbor/blob/main/apps/worker/src/execution/lifecycle.ts).
