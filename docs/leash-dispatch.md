# Leash agent dispatch wiring

This adds execution code, not a deployed or funded service. Operators must deploy the reviewed fresh Leash contract and the private signer service before enabling it. Never put signer secrets in the browser or the Harbor Worker.

Required Harbor bindings/vars:

- `LEASH_CONTRACT_ID`, `LEASH_AGENT_ACCOUNT_ID`: deployed mainnet identities.
- `LEASH_CONTRACT_CODE_HASH`: exact base58 code hash of the reviewed deployed contract. A code change blocks submission until reviewed and reconfigured.
- `LEASH_SIGNER`: private service binding to the separately deployed signer Worker. No public signer URL is accepted.
- `LEASH_EXECUTION_ENABLED=true`, `EXECUTION_ENABLED=true`, and `oneclick` in `ENABLED_WRITE_ADAPTERS`.
- Apply migration `0008_leash_approvals.sql` after `0007_leash_executions.sql` using the normal deployment migration workflow.

Owner wallet-session API:

1. `POST /api/leash/approve` with `{ "quoteResponse": <provider-signed executable quote> }`. The owner explicitly approves this quote. Harbor validates signature, current vault caps and reviewed contract code, captures the destination balance independently, and stores immutable approved bytes. Returns execution `id` and exact request; does not submit.
2. `POST /api/leash/executions/:id/submit` dispatches only those stored bytes. Current vault/code checks run again. The durable journal atomically claims the execution before contacting the signer. Duplicate payloads cannot dispatch twice.
3. `GET /api/leash/executions/:id` recovers a hash from the private signer if needed, then verifies exact finalized payment and independently checks destination delivery. A provider success message alone is not settlement. Refunds are not successes.

If submission times out, **do not retry with another ID or quote**. Query the execution status. A claimed execution is never automatically resubmitted. Unknown remains unknown until chain evidence is available.

This implements explicitly owner-approved dispatch. It does not grant unrestricted autonomous strategy approval and does not execute trades as part of a monitoring tick. The operator must provide the restricted execute-only signer key directly to the private signer, then manually verify a small funded end-to-end deployment. Local tests do not establish mainnet deployment or zero-risk behavior.
