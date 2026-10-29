ALTER TABLE `invoices` ADD `status_description` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `external_reference` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `municipal_service_id` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `municipal_service_code` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `municipal_service_name` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `update_payment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `validation_code` text;