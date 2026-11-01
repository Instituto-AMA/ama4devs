ALTER TABLE `accounts` ADD `notify_email` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `notify_whatsapp` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `notify_sms` integer DEFAULT true NOT NULL;