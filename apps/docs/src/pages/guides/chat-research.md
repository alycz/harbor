# Chat and research

## Ask for research

Harbor's agent has a `list_markets` tool for dated market research and a `propose_intent` tool for swap proposals. Use a prompt such as “Show me research on NEAR yield pools” to explore available observations. Results depend on the committed snapshot and model configuration.

With no `OPENROUTER_API_KEY`, the response is scripted. Adding a key enables the configured free OpenRouter model; a key does not enable financial execution.

## Read research correctly

Research and Earn use `research/data/research-snapshot.json`. Responses include source attribution, capture dates, and caveats. Yield results explicitly report `live: false` and `executable: false`.

APY is an observation, not a guarantee or an executable quote. Empty results may mean the snapshot has not been populated, or that filters match nothing. Maintainers can run `pnpm research:collect` to refresh public-source data, then review the generated changes and provenance before committing.

## Proposals are not actions

A proposal creates typed intent data for the execution lifecycle. The model cannot authorize a deposit, invent balances, sign transactions, or turn untrusted website text into instructions. Inspect [swap plans](/guides/swap-plans) before treating a proposal as actionable.

## Limits and interruptions

The default guest allowance is five turns per fifteen minutes; global active runs default to four. A busy conversation returns a conflict rather than starting a second answer. Event streams support resuming after an event ID, and a run can be stopped through the abort endpoint.

Never send seed phrases or secret keys. The route rejects NEAR secret-key-shaped text before storage or model use, but pattern detection is not a general secret sanitizer.

Sources: [agent tools](https://github.com/alycz/harbor/blob/main/apps/worker/src/agent/tools.ts), [chat routes](https://github.com/alycz/harbor/blob/main/apps/worker/src/agent/routes.ts), [market routes](https://github.com/alycz/harbor/blob/main/apps/worker/src/markets/routes.ts).
