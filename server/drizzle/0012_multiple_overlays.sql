CREATE TABLE `overlays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`name` text NOT NULL,
	`token` text NOT NULL,
	`width` integer DEFAULT 1920 NOT NULL,
	`height` integer DEFAULT 1080 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `overlays_token_idx` ON `overlays` (`token`);
--> statement-breakpoint
CREATE INDEX `overlays_user_idx` ON `overlays` (`user_id`);
--> statement-breakpoint
INSERT INTO `overlays` (`user_id`, `name`, `token`, `width`, `height`, `created_at`)
SELECT `id`, 'Main overlay', `overlay_token`, `overlay_width`, `overlay_height`, `created_at` FROM `users`;
--> statement-breakpoint
ALTER TABLE `commands` ADD `overlay_id` integer REFERENCES `overlays`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE `commands` SET `overlay_id` = (
	SELECT `overlays`.`id` FROM `overlays` WHERE `overlays`.`user_id` = `commands`.`user_id`
);