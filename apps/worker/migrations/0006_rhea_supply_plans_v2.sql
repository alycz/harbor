CREATE TABLE `rhea_supply_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`account_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`token_id` text NOT NULL,
	`symbol` text NOT NULL,
	`decimals` integer NOT NULL,
	`extra_decimals` integer NOT NULL,
	`amount_raw` text NOT NULL,
	`digest` text NOT NULL,
	`status` text NOT NULL,
	`tx_hash` text,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "rhea_supply_plans_network_ck" CHECK(network IN ('mainnet', 'testnet')),
	CONSTRAINT "rhea_supply_plans_status_ck" CHECK(status IN ('awaiting_review', 'awaiting_signature', 'submitted', 'confirmed', 'refunded', 'failed', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rhea_supply_plans_idempotency_uq` ON `rhea_supply_plans` (`network`,`account_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `rhea_supply_plans_tx_hash_uq` ON `rhea_supply_plans` (`tx_hash`);--> statement-breakpoint
CREATE INDEX `rhea_supply_plans_account_idx` ON `rhea_supply_plans` (`account_id`,`created_at_ms`);