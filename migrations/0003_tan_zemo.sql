PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text,
	`remind_at` integer NOT NULL,
	`channel` text NOT NULL,
	`sent_at` integer,
	`dedupe_key` text NOT NULL,
	FOREIGN KEY (`occurrence_id`) REFERENCES `chore_occurrences`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_reminders`("id", "occurrence_id", "remind_at", "channel", "sent_at", "dedupe_key") SELECT "id", "occurrence_id", "remind_at", "channel", "sent_at", "dedupe_key" FROM `reminders`;--> statement-breakpoint
DROP TABLE `reminders`;--> statement-breakpoint
ALTER TABLE `__new_reminders` RENAME TO `reminders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_dedupe_key_unique` ON `reminders` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `reminders_pending_idx` ON `reminders` (`remind_at`);--> statement-breakpoint
ALTER TABLE `households` ADD `digest_hour` integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE `households` ADD `quiet_start_hour` integer DEFAULT 22 NOT NULL;--> statement-breakpoint
ALTER TABLE `households` ADD `quiet_end_hour` integer DEFAULT 7 NOT NULL;