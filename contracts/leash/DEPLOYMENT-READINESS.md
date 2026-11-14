# Leash deployment handoff

Readiness snapshot: 2026-11-14. Source exists; this is not a deployed or audited service.

## Required decisions before signing anything

- Network, dedicated contract account, and the trusted agent account.
- Funding cap for contract storage, gas, and later per-deposit token registration.
- Hackathon track requirements; deploying a contract alone may not qualify.
- Mainnet review versus a testnet demonstration. No real user budgets until reviewed.

The README's approximately 3 NEAR storage estimate is not a measured quote. Build size,
account state and storage usage must determine the final amount. Contract execution also
spends its own NEAR on token registration (currently 0.00125 NEAR) and one yocto per transfer.

## Build blockers observed

The selected Mac has no cargo, cargo-near or near CLI in PATH or the checked standard locations.
Docker CLI exists but no reachable daemon was reported. No WASM artifact or checksum was produced.
Use a reviewed official Rust/NEAR build environment and the README's reproducible build command.
Do not treat source code or unit-test files as evidence of a passing build.

## Worker integration still required

- Configure the deployed contract ID and verify get_agent against the intended account.
- Owner explicitly sets limits and funds the vault; never reuse swap approval as vault consent.
- Use oneClickQuotePayload(response) from the existing signature module for the exact signed JSON.
  Leash.execute takes that string and the provider signature, not the entire response or its hash.
- Preserve the verified quote payload/signature with the plan. Current swap records alone are
  insufficient to reconstruct provider-signed bytes safely.
- Add an explicitly bounded agent signer only after authority is approved. No private key in source,
  logs, browser storage or model context. Preserve one-tap owner signing as the default.
- Independently verify contract payment and destination settlement; a successful execute receipt
  proves neither destination delivery nor profitable execution.
- Expose owner freeze, unfreeze, withdraw and recovery. Contract refunds go to owner, not vault.

This handoff changes no execution flag, deployed account, credential, or financial transaction.

## Combined implementation update

The build-only GitHub workflow now produces WASM and checksum/source metadata; verify the
artifact corresponds to the final approved commit. Mac-local tooling remains unavailable.
Worker integration now provides authenticated `/api/leash/vault` and `/api/leash/preview`.
Both remain read/preview-only with `executionAvailable: false`; no signer or submit endpoint exists.
Configure `LEASH_CONTRACT_ID` and `LEASH_AGENT_ACCOUNT_ID` only after selecting the deployment.
Pending-callback accounting fixes add persisted state: this build is for a fresh deployment,
not an in-place upgrade of an existing contract without a separately reviewed migration.

## Unsigned wallet wiring

`POST /api/leash/prepare-owner-action` now constructs owner-wallet calls for `set_limits`,
`fund`, `freeze`, `unfreeze`, and `withdraw`. Amounts and storage deposit are explicit atomic
strings, not inferred spending permission. The session owner is the required signer. It
performs identity/vault reads but no signing, broadcast, or guarantee of execution. Token
storage registration and balance checks still belong to the wallet/contract workflow.
`POST /api/leash/preview` additionally returns the exact unsigned agent `execute` call after
provider-signature and limit checks. Its `signerId` is the configured agent, not the owner.
No secret signing service or automatic submission exists. `executionAvailable: false` remains
intentional until an authorized external signer and receipt lifecycle are connected.
