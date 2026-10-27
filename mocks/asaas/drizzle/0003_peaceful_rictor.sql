CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`payment_id` text,
	`event` text NOT NULL,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text,
	`body` text NOT NULL,
	`template` text,
	`forced` integer NOT NULL,
	`status` text NOT NULL,
	`attempt` integer NOT NULL,
	`last_error` text,
	`date_created` text NOT NULL,
	`sent_at` text,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_status_idx` ON `notification_deliveries` (`status`,`created_at_ms`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_payment_idx` ON `notification_deliveries` (`payment_id`);