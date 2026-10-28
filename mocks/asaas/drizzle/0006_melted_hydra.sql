CREATE TABLE `request_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`api_key_id` text,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`query` text NOT NULL,
	`status` integer NOT NULL,
	`request_body` text,
	`response_body` text,
	`date_created` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `request_logs_account_idx` ON `request_logs` (`account_id`,`id`);