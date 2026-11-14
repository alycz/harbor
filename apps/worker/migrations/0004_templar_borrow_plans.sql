CREATE TABLE templar_borrow_plans (
 id TEXT PRIMARY KEY, account TEXT NOT NULL, market TEXT NOT NULL, amount TEXT NOT NULL,
 payload TEXT NOT NULL, digest TEXT NOT NULL, nonce TEXT NOT NULL, recipient TEXT NOT NULL,
 expires INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('prepared','issued','confirmed')),
 tx_hash TEXT UNIQUE
);
CREATE INDEX templar_borrow_account ON templar_borrow_plans(account);
