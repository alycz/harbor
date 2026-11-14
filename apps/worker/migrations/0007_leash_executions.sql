CREATE TABLE leash_executions (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL,
 digest TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('claimed','submitted','outcome_unknown')),
 tx_hash TEXT UNIQUE,
 created_at_ms INTEGER NOT NULL
);
CREATE INDEX leash_executions_owner ON leash_executions(owner);
