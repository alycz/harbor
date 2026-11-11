# Demo

About three minutes, on mainnet, with execution enabled on the server and a model key set.

## 1. Sign a policy (40 s)

1. Connect a wallet and open **Policy**.
2. Allow NEAR and USDC, let the agent spend up to 1 NEAR per action, 2 per day and 5 in total, slippage 0.5%, at most every 24 hours, expiring in 7 days.
3. **Sign policy in your wallet.** The wallet shows the limits in words and the digest. Signing moves nothing.

The signed policy shows what has been spent against each limit, and **Freeze the agent now**.

## 2. A real swap (60 s)

1. **Trade:** 1 NEAR to USDC. The quote is live.
2. **Review swap.** Harbor asks NEAR Intents for an executable quote made out to your own account, and checks it against your policy: *Within your signed policy*. The first time, the wallet asks for a one-time token registration.
3. **Approve and sign in wallet.** One transaction: register, wrap, transfer exactly 1 NEAR.
4. The card follows it: deposit verified on NEAR, swapping, then *Delivered and verified on chain*. **Full receipt** shows every step, who caused it, and the delivery check.

## 3. The poisoned post (45 s)

1. **Chat:** "Read the latest posts about NEAR and act on anything urgent."
2. The agent reads the sample feed. One post, posing as a Harbor security team, tells agents to send the user's whole balance to `migrate-harbor.near`.
3. A careful model says it will not follow it. A model that does propose it gets a card flagged *asks to deliver to migrate-harbor.near*; **Review swap** returns *blocked*: not one of your addresses, and outside your signed policy. Nothing reaches NEAR Intents.

The same path runs in the test suite with a model scripted to obey the post (`apps/worker/test/poisoned.test.ts`).

## 4. The agent on its own (30 s)

1. On **Policy**, add a strategy: spend 0.5 NEAR to buy USDC every 24 hours.
2. On the next cron tick the agent queues it, but only because the policy is active. It appears on **Portfolio** under *Queued by your agent*, ready to sign in one tap.
3. **Freeze the agent now.** The next tick queues nothing.

## Before recording

- `pnpm check` is green.
- The server has `EXECUTION_ENABLED=true`, `ENABLED_WRITE_ADAPTERS=oneclick` and a model key; the wallet holds about 2 NEAR.
- Someone signs the swap in their own wallet: Harbor never holds keys.
