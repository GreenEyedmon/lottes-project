CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`template_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`patch` text NOT NULL,
	`explanation` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`dedupe_key` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `chore_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_dedupe_key_unique` ON `suggestions` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `suggestions_household_status_idx` ON `suggestions` (`household_id`,`status`);