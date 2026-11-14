# Templar borrow lifecycle

Depends on the preparation adapter in PR #11. Apply migration 0004_templar_borrow_plans.sql through the normal D1 migration workflow before using these endpoints.

No runtime settings are changed by this PR. Borrowing requires all of:
- NEAR_NETWORK=mainnet
- EXECUTION_ENABLED=true
- ENABLED_WRITE_ADAPTERS contains templar
- The market appears in Templar's dynamically fetched official active catalogue, belongs to its on-chain registry, has the deployed registry code hash, and returns a supported configuration. No per-market environment allowlist is required.

The registry includes retired deployments. The official current-market catalogue is therefore checked at plan creation and approval; registry presence alone does not permit signing. Catalogue outages or format changes fail closed. Market listing does not guarantee liquidity or current oracle health.

The borrower must already have market registration and collateral. Borrow asset recipient registration may also be required by the token. The contract enforces collateral/oracle/liquidity conditions; Harbor does not promise execution or quote fixed debt terms.

POST /api/templar/borrow-plans creates a two-minute immutable plan containing the entire configuration and exact transaction. POST /:id/approve verifies an account-owned full-access-key NEP413 signature and atomically issues the wallet request once. GET /:id recovers plan state. POST /:id/receipt checks the exact hash, signer, target, method, arguments, deposit, gas, FINAL execution and all returned receipt outcomes independently through configured NEAR RPC.

The server never signs, broadcasts or holds keys. Frontend wallet submission always needs explicit user action. Issued transactions have no contract-enforced Harbor deadline. Interrupted submission is ambiguous: inspect wallet history, recover the plan by ID and post its transaction hash; never automatically resubmit.

Confirmation means successful finalized loan origination, not repayment, closure, health monitoring, or an independently reconstructed ongoing debt balance. Collateral deposits, repayments and withdrawals remain preparation-only. This flow is separate from swap policy/autopilot and cannot be autonomously invoked as a swap.

No tests or live transactions were run, as requested. Migration, merge, deployment and runtime enablement remain operator tasks.
