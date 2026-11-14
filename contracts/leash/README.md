# Leash

A NEAR contract that holds an owner's budget and lets Harbor's agent spend it only inside the owner's limits, enforced on chain rather than on Harbor's server. The design is in [docs/spikes/autonomy.md](../../docs/spikes/autonomy.md).

- The owner opens a vault with `set_limits` (token, per-action and daily caps, assets they may buy, their own recipients, slippage, expiry), then funds it with `ft_transfer_call` on that token.
- The agent's key is a function-call key for `execute` alone. `execute` pays a 1Click deposit address only if 1Click's key signed the quote, and the quote sells the vault's token, buys an allowed asset, delivers to one of the owner's recipients, refunds to the owner, fits the caps and slippage, has not expired, and has not been paid before.
- The owner can `freeze`, `unfreeze` and `withdraw` at any time. The agent can do none of these.

## Test

```sh
cargo test
```

## Build and deploy

Deploying is a person's decision: it needs a mainnet account, a measured storage budget plus state, gas and operating reserves, and the agent account it will trust.

```sh
cargo near build reproducible-wasm
near contract deploy <leash-account> use-file target/near/harbor_leash.wasm \
  with-init-call new json-args '{"agent":"<agent-account>","quote_signer":"ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc"}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
```

`quote_signer` is 1Click's manager key, the one `packages/adapters/src/oneclick/signature.ts` verifies quotes with. Try the whole flow on testnet, with a stand-in signer key, before mainnet.

Harbor includes owner wallet setup/funding actions, explicitly owner-approved dispatch, immutable request and balance-baseline storage, durable replay protection, a private execute-scoped signer service, and receipt/delivery reconciliation. The Automations UI accepts a complete provider-signed quote JSON for review and explicit approval. This is not deployed or verified unattended trading: operators still must provision owned contract/agent accounts, a restricted signer key, private service binding, reviewed code hash, migrations and execution settings, then validate a funded end-to-end flow. See [dispatch setup](../../docs/leash-dispatch.md) and [private signer setup](../../apps/leash-signer/README.md).

Budget from the exact WASM and current network storage cost, not a fixed 3 NEAR estimate. For reference, a 378,960-byte artifact at 10^19 yoctoNEAR per byte consumes about 3.7896 NEAR for code alone; account/state storage, gas and operating reserves are additional. Recalculate for the artifact you actually deploy.

## Build artifact without a local Rust installation

The **Leash WASM** GitHub Actions workflow builds the locked dependencies on contract
pull requests and main changes, or on manual dispatch. Download its `leash-wasm-<commit>`
artifact after the build succeeds. It contains `harbor_leash.wasm`, `SHA256SUMS`, and
`BUILD.txt` identifying the source commit. Verify `sha256sum -c SHA256SUMS` before use.
This is a release build, not the Docker-based reproducible build above; the workflow
records the compiler version. It runs the contract unit tests but does not deploy, provision an account,
load keys, authorize an agent, or spend funds. Build success does not establish
mainnet readiness or an end-to-end Agent Economy demonstration.

For a testnet demonstration, use a dedicated testnet account, a testnet token and a
clearly labelled stand-in quote signer. 1Click settlement is mainnet-only; do not
present a testnet stand-in as actual 1Click settlement. The same contract ABI is used
on both networks. Never initialize it with an arbitrary agent account: that account
is the sole execution authority for every funded vault in that deployment.

### Pending-transfer accounting

Token changes wait for every outstanding transfer callback, including withdrawals.
Failed executions restore daily allowance only in the same spending window that
reserved it. The `pending_transfers` field changes the stored vault layout: this
version is for a fresh deployment, **not an in-place upgrade of an existing vault**
without a separately reviewed state migration. The public Worker-facing ABI is
unchanged; the private execution callback now also receives its spending-window ID.

Operating NEAR is a shared deployment reserve, not part of each vault's token budget:
every attempted deposit may consume registration cost, transfer dust and replay-record
storage. A production deployment still needs explicit operating-reserve accounting;
token spending caps alone do not isolate those costs between vaults.
