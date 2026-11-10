# Harbor

Cross-chain DeFi research and reviewed swap plans, built around explicit user limits.

Harbor is the application in [alycz/harbor](https://github.com/alycz/harbor). It combines a React interface, a Cloudflare Worker, NEAR wallet sign-in, and verified NEAR Intents 1Click quotes. The agent proposes typed intents; it does not hold your keys.

:::warning[Read this before using funds]
Harbor is a work-in-progress hackathon application. The committed configuration disables execution. Deposit submission, independently verified settlement receipts, and autonomous policy enforcement are not implemented. A quote or reviewed plan is not a completed swap.
:::

## Choose your path

- **Try the app:** [Quick start](/quick-start), with no model key required.
- **Understand what works:** [Current capabilities](/status), separating shipped code from planned behavior.
- **Explore the product:** [Chat and research](/guides/chat-research), [swap plans](/guides/swap-plans), and [price alerts](/guides/price-alerts).
- **Contribute:** [Architecture](/developers/architecture), [API reference](/developers/api), and [safety rules](/developers/safety).

## The intended model

Ask in plain language, inspect the proposed action, and retain control of approvals. Harbor's longer-term policy model describes budgets, assets, your own destination addresses, schedules, and expiry. Today that signed-policy schema is present, but the signing and enforcement flow is not.

These docs describe repository behavior, not a guarantee of production availability, investment returns, or safety of third-party venues. Research snapshots are dated observations, not executable quotes.
