# Intents round-trip monitoring

`POST /api/automations/roundtrip-preview` accepts `{sellAssetId,buyAssetId,amount,minSpreadBps?}`. Asset IDs must come from Harbor's network registry. This performs two real dry 1Click quotes, never creates a deposit address, and never signs or broadcasts a transaction. The return leg uses the outbound minimum output as its input.

- `opportunity` means the conservative return exceeds the input and meets the requested gross basis-point threshold; it is not a net-profit or execution guarantee.
- `below_threshold` means valid live quotes did not meet that threshold.
- `unknown` means a quote failed, was malformed, or exceeded the local 30-second freshness window. A missing quote is not a negative opportunity.
- `grossSpreadBps` is an exact decimal string; `netProfit` stays null. External funding gas and all execution costs are not independently accounted for.
- `expiresAt` is a local freshness cutoff (`expirySource: local_freshness_window`), not a provider-reserved execution window. The two legs are sequential and non-atomic. Funds cannot arrive in time to rely on the return quote remaining unchanged.
- `executionAvailable` is always false. Review and obtain fresh owner-approved execution quotes separately.

This is an on-demand preview endpoint. Existing price-alert automations remain the persistent scheduled monitoring system; the round-trip preview does not create a background rule or queue a transaction. Supported assets/chains are limited to the verified registry and available provider routes, not all chains.

No migration or deployment required for source integration; teammate deployment is separate. No live trading or deployed endpoint verification was performed.
