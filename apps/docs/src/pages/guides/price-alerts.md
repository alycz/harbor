# Price alerts

Harbor automations currently monitor quoted prices. They do not sign, submit, or move funds.

## Configure a monitor

A `price_alert` specifies a sell asset and amount, a buy asset, the minimum quoted output that should trigger an alert, a cooldown, and a mode. Asset IDs must be venue IDs such as `nep141:wrap.near`, not symbols alone.

- `once` stops after the first alert.
- `repeat` re-arms when the price falls back below the target.
- `cooldownMinutes` must be an integer from 1 through 1,440.
- Sell amount and target output must be positive plain decimal strings.

## Review and activate

Create a draft, inspect its configuration, and activate the exact `revision` and `configHash` returned by the server. Edits use `expectedRevision` so stale changes cannot silently replace newer settings. Use preview or test to evaluate without firing an alert. Pause a rule when you no longer want checks; acknowledge individual alerts separately.

## Scheduling

A one-minute cron wakes the dispatcher. D1 stores the due work, leases, revisions, and alerts; the cron is a wake-up signal, not an exact execution-time guarantee. Quote failures or missing routes should not be mistaken for a target being met.

For local development, while the app is running:

```sh
pnpm --filter @harbor/worker cron:local
```

Monitoring is separate from the planned autonomous trading policy. Activating an alert does not authorize a recurring swap.

Sources: [monitor schema](https://github.com/alycz/harbor/blob/main/apps/worker/src/automations/config.ts), [routes](https://github.com/alycz/harbor/blob/main/apps/worker/src/automations/routes.ts), [dispatcher](https://github.com/alycz/harbor/blob/main/apps/worker/src/automations/dispatch.ts).
