CREATE TABLE `timers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`messages` text NOT NULL,
	`interval_min` integer DEFAULT 15 NOT NULL,
	`offline_interval_min` integer DEFAULT 0 NOT NULL,
	`min_chat_lines` integer DEFAULT 5 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `timers_user_idx` ON `timers` (`user_id`);--> statement-breakpoint
ALTER TABLE `commands` ADD `trigger` text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE `commands` ADD `reply` text;--> statement-breakpoint
ALTER TABLE `commands` ADD `aliases` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `commands` ADD `min_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `commands` ADD `use_count` integer DEFAULT 0 NOT NULL;