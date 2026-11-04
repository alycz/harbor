# Research data

Dated, read-only snapshots the app and the agent cite. Nothing here is a live rate or an executable quote.

- `research-snapshot.json`: chains, protocols and yield pools on the chains Harbor can reach through NEAR Intents, each row naming the source it came from (schema `harbor.research.v1`, parsed by `@harbor/data/research`).
- `research-history.json`: weekly DeFi TVL for NEAR, Ethereum, Solana, Base and Arbitrum over the last year (schema `harbor.research.history.v1`).

Both come from DefiLlama's public APIs. To refresh them, run `pnpm research:collect` and commit the result; the capture time is recorded in each source.
