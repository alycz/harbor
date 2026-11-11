CREATE TABLE `autopilot_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`strategy_id` text NOT NULL,
	`owner_account` text NOT NULL,
	`intent_id` text,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`strategy_id`) REFERENCES `strategies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `autopilot_runs_owner_idx` ON `autopilot_runs` (`owner_account`,`status`,`created_at_ms`);--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`owner_account` text NOT NULL,
	`kind` text NOT NULL,
	`sell_asset` text NOT NULL,
	`buy_asset` text NOT NULL,
	`amount_raw` text NOT NULL,
	`every_seconds` integer NOT NULL,
	`status` text NOT NULL,
	`next_run_at_ms` integer,
	`last_run_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "strategies_network_ck" CHECK(network IN ('mainnet', 'testnet')),
	CONSTRAINT "strategies_status_ck" CHECK(status IN ('active', 'paused', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX `strategies_due_idx` ON `strategies` (`network`,`status`,`next_run_at_ms`);--> statement-breakpoint
CREATE INDEX `strategies_owner_idx` ON `strategies` (`network`,`owner_account`);