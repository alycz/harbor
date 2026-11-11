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

Deploying is a person's decision: it needs a mainnet account, about 3 NEAR for storage, and the agent account it will trust.

```sh
cargo near build reproducible-wasm
near contract deploy <leash-account> use-file target/near/harbor_leash.wasm \
  with-init-call new json-args '{"agent":"<agent-account>","quote_signer":"ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc"}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
```

`quote_signer` is 1Click's manager key, the one `packages/adapters/src/oneclick/signature.ts` verifies quotes with. Try the whole flow on testnet, with a stand-in signer key, before mainnet.

Harbor's Worker does not call this contract yet: until it is deployed and audited, every deposit is signed in the owner's own wallet.
