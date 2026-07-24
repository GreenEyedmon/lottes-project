CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`occurrence_id` text,
	`actor_id` text,
	`type` text NOT NULL,
	`payload` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`occurrence_id`) REFERENCES `chore_occurrences`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_household_at_idx` ON `activity_events` (`household_id`,`at`);--> statement-breakpoint
CREATE TABLE `chore_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`template_id` text,
	`due_date` text NOT NULL,
	`due_time` text,
	`due_instant` integer NOT NULL,
	`state` text NOT NULL,
	`responsible_id` text,
	`postponed_from` text,
	`title` text,
	`priority` integer,
	`generation_key` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `chore_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responsible_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chore_occurrences_generation_key_unique` ON `chore_occurrences` (`generation_key`);--> statement-breakpoint
CREATE INDEX `occurrences_household_state_due_idx` ON `chore_occurrences` (`household_id`,`state`,`due_date`);--> statement-breakpoint
CREATE INDEX `occurrences_template_idx` ON `chore_occurrences` (`template_id`);--> statement-breakpoint
CREATE TABLE `chore_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`room_id` text,
	`recurrence` text NOT NULL,
	`missed_policy` text NOT NULL,
	`status` text NOT NULL,
	`start_date` text NOT NULL,
	`due_time` text,
	`estimated_effort_minutes` integer,
	`default_responsible_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_responsible_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `templates_household_status_idx` ON `chore_templates` (`household_id`,`status`);--> statement-breakpoint
CREATE TABLE `completion_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`completed_by_id` text NOT NULL,
	`completed_at` integer NOT NULL,
	`was_early` integer NOT NULL,
	`was_late` integer NOT NULL,
	`by_non_assignee` integer NOT NULL,
	`effort_actual_minutes` integer,
	`notes` text,
	FOREIGN KEY (`occurrence_id`) REFERENCES `chore_occurrences`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_by_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`iana_time_zone` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `members_household_idx` ON `members` (`household_id`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`remind_at` integer NOT NULL,
	`channel` text NOT NULL,
	`sent_at` integer,
	`dedupe_key` text NOT NULL,
	FOREIGN KEY (`occurrence_id`) REFERENCES `chore_occurrences`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_dedupe_key_unique` ON `reminders` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `reminders_pending_idx` ON `reminders` (`remind_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
