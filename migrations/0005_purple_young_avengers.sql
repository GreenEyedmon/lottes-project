ALTER TABLE `households` ADD `reminders_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `households` ADD `digest_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `households` ADD `activity_enabled` integer DEFAULT false NOT NULL;