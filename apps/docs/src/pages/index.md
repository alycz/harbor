# Harbor

Cross-chain DeFi research and reviewed swap plans, built around explicit user limits.

Harbor is the application in [alycz/harbor](https://github.com/alycz/harbor). It combines a React interface, a Cloudflare Worker, NEAR wallet sign-in, and verified NEAR Intents 1Click quotes. The agent proposes typed intents; it does not hold your keys.

:::warning[Read this before using funds]
Harbor is a hackathon build. Execution is off in the committed configuration; with it on, every deposit is signed in your own wallet and moves real funds on mainnet. Unattended trading is not enabled. A quote or a reviewed plan is not a completed swap.
:::

## Choose your path

- **Try the app:** [Quick start](/quick-start), with no model key required.
- **Understand what works:** [Current capabilities](/status), what is tested, what was checked against the real service, and what is not verified live.
- **Explore the product:** [Chat and research](/guides/chat-research), [swap plans](/guides/swap-plans), and [price alerts](/guides/price-alerts).
- **Contribute:** [Architecture](/developers/architecture), [API reference](/developers/api), and [safety rules](/developers/safety).

## How it works

Ask in plain language, inspect the proposed action, and retain control of approvals. A policy you sign sets budgets, assets, your own destination addresses, a schedule and an expiry, and every plan is checked against it. Policy conflicts require owner review; transactions outside Harbor are not restricted by Harbor's policy.

These docs describe repository behavior, not a guarantee of production availability, investment returns, or safety of third-party venues. Research snapshots are dated observations, not executable quotes.
