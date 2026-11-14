CREATE TABLE rhea_supply_plans (
 id TEXT PRIMARY KEY, network TEXT NOT NULL CHECK(network='mainnet'), account_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, message TEXT NOT NULL,
 nonce TEXT NOT NULL, recipient TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','approved','awaiting_signature','confirmed','outcome_unknown','cancelled')),
 tx_hash TEXT UNIQUE, created_at_ms INTEGER NOT NULL, expires_at_ms INTEGER NOT NULL,
 UNIQUE(network,account_id,idempotency_key)
);
CREATE INDEX rhea_supply_owner ON rhea_supply_plans(account_id, created_at_ms);
