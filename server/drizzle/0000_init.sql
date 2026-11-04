CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`command_name` text NOT NULL,
	`viewer` text NOT NULL,
	`status` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_user_created_idx` ON `activity` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `commands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`animation` text NOT NULL,
	`image_url` text,
	`sound_url` text,
	`sound_volume` integer DEFAULT 70 NOT NULL,
	`text` text NOT NULL,
	`duration_ms` integer DEFAULT 5000 NOT NULL,
	`user_cooldown_sec` integer DEFAULT 30 NOT NULL,
	`global_cooldown_sec` integer DEFAULT 5 NOT NULL,
	`permission` text DEFAULT 'everyone' NOT NULL,
	`show_username` integer DEFAULT true NOT NULL,
	`style` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `commands_user_name_idx` ON `commands` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`original_name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`twitch_id` text NOT NULL,
	`login` text NOT NULL,
	`display_name` text NOT NULL,
	`profile_image_url` text,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`overlay_token` text NOT NULL,
	`overlay_width` integer DEFAULT 1920 NOT NULL,
	`overlay_height` integer DEFAULT 1080 NOT NULL,
	`chat_enabled` integer DEFAULT true NOT NULL,
	`auth_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_twitch_id_idx` ON `users` (`twitch_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_overlay_token_idx` ON `users` (`overlay_token`);