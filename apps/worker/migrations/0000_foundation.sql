CREATE TABLE `asset_registry` (
	`network` text NOT NULL,
	`canonical_id` text NOT NULL,
	`symbol` text NOT NULL,
	`decimals` integer NOT NULL,
	`verified_source` text NOT NULL,
	`verified_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`network`, `canonical_id`),
	CONSTRAINT "asset_registry_network_ck" CHECK(network IN ('mainnet', 'testnet')),
	CONSTRAINT "asset_registry_decimals_ck" CHECK("asset_registry"."decimals" BETWEEN 0 AND 38)
);
--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`nonce` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`account_id` text NOT NULL,
	`browser_session_hash` text NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`consumed_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	CONSTRAINT "auth_challenges_network_ck" CHECK(network IN ('mainnet', 'testnet'))
);
--> statement-breakpoint
CREATE INDEX `auth_challenges_expiry_idx` ON `auth_challenges` (`expires_at_ms`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`wallet_account_id` text NOT NULL,
	`network` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`revoked_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wallet_account_id`) REFERENCES `wallet_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auth_sessions_network_ck" CHECK(network IN ('mainnet', 'testnet'))
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `automation_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`revision` integer NOT NULL,
	`scheduled_for_ms` integer NOT NULL,
	`evaluated_at_ms` integer NOT NULL,
	`result` text NOT NULL,
	`reason` text NOT NULL,
	`evidence` text NOT NULL,
	`triggered` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `automation_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `automation_evaluations_rule_idx` ON `automation_evaluations` (`rule_id`,`evaluated_at_ms`);--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`owner_account` text,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`config` text NOT NULL,
	`config_hash` text NOT NULL,
	`mode` text NOT NULL,
	`interval_ms` integer NOT NULL,
	`cooldown_ms` integer NOT NULL,
	`armed` integer DEFAULT 1 NOT NULL,
	`next_due_at_ms` integer,
	`last_evaluated_at_ms` integer,
	`last_result` text,
	`last_triggered_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "automation_rules_network_ck" CHECK(network IN ('mainnet', 'testnet')),
	CONSTRAINT "automation_rules_status_ck" CHECK(status IN ('draft', 'active', 'paused', 'completed', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX `automation_rules_due_idx` ON `automation_rules` (`network`,`status`,`next_due_at_ms`);--> statement-breakpoint
CREATE TABLE `automation_triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`revision` integer NOT NULL,
	`trigger_key` text NOT NULL,
	`evaluation_id` text NOT NULL,
	`summary` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`acknowledged_at_ms` integer,
	FOREIGN KEY (`rule_id`) REFERENCES `automation_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_triggers_trigger_key_unique` ON `automation_triggers` (`trigger_key`);--> statement-breakpoint
CREATE INDEX `automation_triggers_rule_idx` ON `automation_triggers` (`rule_id`,`created_at_ms`);--> statement-breakpoint
CREATE TABLE `intents` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`kind` text NOT NULL,
	`sell_asset` text NOT NULL,
	`buy_asset` text NOT NULL,
	`sell_amount_raw` text NOT NULL,
	`source` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	CONSTRAINT "intents_network_ck" CHECK(network IN ('mainnet', 'testnet'))
);
--> statement-breakpoint
CREATE TABLE `plan_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plan_events_plan_idx` ON `plan_events` (`plan_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`intent_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`network` text NOT NULL,
	`account_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`digest` text NOT NULL,
	`policy` text NOT NULL,
	`valid_until_ms` integer,
	`approved_at_ms` integer,
	`tx_hash` text,
	`result` text,
	`error_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `intents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plans_network_ck" CHECK(network IN ('mainnet', 'testnet')),
	CONSTRAINT "plans_status_ck" CHECK(status IN ('policy_checked', 'blocked', 'awaiting_review', 'awaiting_signature', 'submitted', 'confirming', 'confirmed', 'failed', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_idempotency_uq` ON `plans` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `plans_network_tx_hash_uq` ON `plans` (`network`,`tx_hash`);--> statement-breakpoint
CREATE INDEX `plans_account_idx` ON `plans` (`network`,`account_id`);--> statement-breakpoint
CREATE TABLE `protocol_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'research' NOT NULL,
	`write_enabled` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "protocol_registry_network_ck" CHECK(network IN ('mainnet', 'testnet')),
	CONSTRAINT "protocol_registry_status_ck" CHECK("protocol_registry"."status" IN ('research', 'read', 'write'))
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`intent_id` text NOT NULL,
	`venue` text NOT NULL,
	`slippage_bps` integer NOT NULL,
	`amount_in_raw` text NOT NULL,
	`amount_out_raw` text NOT NULL,
	`min_out_raw` text NOT NULL,
	`price_impact_bps` integer,
	`protocols` text NOT NULL,
	`provider_quote` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	FOREIGN KEY (`intent_id`) REFERENCES `intents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quotes_intent_idx` ON `quotes` (`intent_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallet_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`network` text NOT NULL,
	`account_id` text NOT NULL,
	`verified_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "wallet_accounts_network_ck" CHECK(network IN ('mainnet', 'testnet'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_accounts_network_account_uq` ON `wallet_accounts` (`network`,`account_id`);--> statement-breakpoint
CREATE INDEX `wallet_accounts_user_idx` ON `wallet_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`dedupe_key` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`run_after_ms` integer NOT NULL,
	`lease_owner` text,
	`lease_until_ms` integer,
	`last_error` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`finished_at_ms` integer,
	CONSTRAINT "jobs_status_ck" CHECK("jobs"."status" IN ('queued', 'running', 'done', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempts_ck" CHECK("jobs"."attempts" >= 0 AND "jobs"."max_attempts" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_key_unique` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_due_idx` ON `jobs` (`status`,`run_after_ms`);--> statement-breakpoint
CREATE INDEX `jobs_kind_idx` ON `jobs` (`kind`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`payload` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`job_id` text,
	`created_at_ms` integer NOT NULL,
	`delivered_at_ms` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_dedupe_key_unique` ON `outbox` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `outbox_undelivered_idx` ON `outbox` (`delivered_at_ms`,`created_at_ms`);