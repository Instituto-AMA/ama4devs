ALTER TABLE `credit_cards` ADD `approvals_left` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `capture_attempts` integer DEFAULT 0 NOT NULL;