# Intents round-trip monitoring

This is distinct from the NEAR-only `spread_alert` monitor, which compares Intents against Rhea. Both coexist with single-route `price_alert` monitors. The Automations page keeps the Intents-only scanner and Rhea/Intents spread workspace separate so a reference-venue signal is not mistaken for an executable two-leg transaction.

`POST /api/automations/roundtrip-preview` accepts `{sellAssetId,buyAssetId,amount,minSpreadBps?}`. Asset IDs must come from Harbor's network registry. This performs two real dry 1Click quotes, never creates a deposit address, and never signs or broadcasts a transaction. The return leg uses the outbound minimum output as its input.

- `opportunity` means the conservative return exceeds the input and meets the requested gross basis-point threshold; it is not a net-profit or execution guarantee.
- `below_threshold` means valid live quotes did not meet that threshold.
- `unknown` means a quote failed, was malformed, or exceeded the local 30-second freshness window. A missing quote is not a negative opportunity.
- `grossSpreadBps` is an exact decimal string; `netProfit` stays null. External funding gas and all execution costs are not independently accounted for.
- `expiresAt` is a local freshness cutoff (`expirySource: local_freshness_window`), not a provider-reserved execution window. The two legs are sequential and non-atomic. Funds cannot arrive in time to rely on the return quote remaining unchanged.
- `executionAvailable` is always false. Review and obtain fresh owner-approved execution quotes separately.

The preview alone is on-demand. To persist a periodic monitor, POST `/api/automations` with `kind: "roundtrip_alert"`, optional `name`, and `config: {sellAssetId,buyAssetId,amount,minSpreadBps,cooldownMinutes,mode}` (`mode`: `once` or `repeat`). This creates a draft; activate the exact returned revision/configHash with `POST /api/automations/:id/activate`. Existing minute scheduler checks it server-side, even when the browser is closed, if the deployment cron and database are configured. Checks are best effort, not real-time: a tick processes bounded batches and delayed slots are skipped rather than replayed.

The existing pause, revision, delete, check-now (`/:id/test`), detail/history and acknowledge-alert endpoints also support roundtrip monitors. Every evaluation records its quote evidence. `opportunity` maps to true, `below_threshold` to false and provider/stale failures to unknown. Repeating alerts re-arm only after a false result, respect cooldown, and deduplicate overlapping ticks. A one-shot monitor completes after its first alert. Alerts are in-app records/outbox events, not email/push notifications or transaction queues. These monitors never trade. Price-alert monitors are unchanged. Supported assets/chains are limited to the verified registry and available provider routes, not all chains.
