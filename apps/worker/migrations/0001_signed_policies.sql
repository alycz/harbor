CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`network` text NOT NULL,
	`owner_account` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`digest` text NOT NULL,
	`message` text NOT NULL,
	`nonce` text NOT NULL,
	`status` text NOT NULL,
	`public_key` text,
	`signature` text,
	`signed_at_ms` integer,
	`frozen_at_ms` integer,
	`expires_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "policies_network_ck" CHECK(network IN ('mainnet', 'testnet')),
	CONSTRAINT "policies_status_ck" CHECK(status IN ('pending', 'active', 'frozen', 'revoked', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `policies_owner_revision_uq` ON `policies` (`network`,`owner_account`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `policies_nonce_uq` ON `policies` (`nonce`);--> statement-breakpoint
CREATE INDEX `policies_owner_status_idx` ON `policies` (`network`,`owner_account`,`status`);--> statement-breakpoint
CREATE TABLE `policy_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`policy_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`policy_id`) REFERENCES `policies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `policy_events_policy_idx` ON `policy_events` (`policy_id`);--> statement-breakpoint
ALTER TABLE `intents` ADD `recipient` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `policy_check` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `policy_id` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `recipient` text;--> statement-breakpoint
ALTER TABLE `plans` ADD `recipient_chain` text;