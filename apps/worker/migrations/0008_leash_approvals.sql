-- Immutable owner-approved payload and independently observed destination baseline.
CREATE TABLE leash_approvals (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL,
 request_json TEXT NOT NULL,
 quote_response TEXT NOT NULL,
 balance_before TEXT,
 created_at_ms INTEGER NOT NULL
);
CREATE INDEX leash_approvals_owner ON leash_approvals(owner);
