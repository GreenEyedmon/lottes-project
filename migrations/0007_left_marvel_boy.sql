CREATE TABLE `grocery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`category` text,
	`default_unit` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grocery_items_household_name_idx` ON `grocery_items` (`household_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `shopping_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity` text,
	`note` text,
	`status` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` integer NOT NULL,
	`purchased_by` text,
	`purchased_at` integer,
	`price_cents` integer,
	`store` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `grocery_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchased_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shopping_household_status_idx` ON `shopping_entries` (`household_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_open_line_idx` ON `shopping_entries` (`household_id`,`item_id`) WHERE "shopping_entries"."status" = 'needed';