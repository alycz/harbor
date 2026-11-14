# Private Leash signer

Concrete NEAR transaction signer for Harbor's private `LEASH_SIGNER` service binding. Not deployed by this change. Never expose this Worker through a route, workers.dev, or preview URL. The service binding is its authentication boundary; only trusted Harbor Workers may receive this binding. Do not proxy it through a public HTTP endpoint.

Team setup:
1. Deploy the reviewed Leash contract. Configure its agent account.
2. Create a dedicated **function-call key**, restricted to that contract and the sole method `execute`, with a finite positive gas allowance. Never use an owner's or agent's full-access key. Fund gas separately; vault policy bounds funds.
3. Configure signer variables `LEASH_AGENT_ACCOUNT_ID`, `LEASH_CONTRACT_ID`. Supply `LEASH_AGENT_PRIVATE_KEY` as a Cloudflare secret using your own secure deployment flow. Do not put the key in source, logs, chat or public Worker variables.
4. Deploy this Worker and its `SIGNER` Durable Object migration. Keep public routes disabled. Add a Harbor service binding named `LEASH_SIGNER` targeting `harbor-leash-signer`. Configure Harbor's own contract/agent IDs and execution gates as documented by the dispatch route.
5. Team must run a small end-to-end funded validation before enabling unattended spending. Unit checks are not proof of mainnet execution.

POST `/v1/submit`: exact existing LeashRequest + `idempotency-key`. GET `/v1/executions/:id`: recover known transaction hash. The Durable Object serializes all actions for one agent and persists nonce, claim and hash before broadcasting. Repeated identical IDs only return the existing hash; conflicting payloads are rejected. Timeouts never trigger rebroadcast. A claimed record without hash requires manual reconciliation. A returned hash means **submitted/attempted**, never settled or delivered. Harbor must verify final receipts and independent destination delivery.

RPC is pinned to NEAR mainnet. On-chain access-key permission is checked before every new signature; full-access and unrestricted method keys are refused. The Leash contract independently verifies provider quote signatures and vault rules. The signer accepts requests only from its trusted private binding, not browsers or LLM output.
