CREATE TABLE `discord_guilds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`guild_id` text NOT NULL,
	`guild_name` text NOT NULL,
	`guild_icon` text,
	`enabled` integer DEFAULT true NOT NULL,
	`channel_id` text,
	`message` text DEFAULT 'Welkom {user} in {server}! 🎉' NOT NULL,
	`card` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_guilds_guild_idx` ON `discord_guilds` (`guild_id`);