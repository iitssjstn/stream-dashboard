ALTER TABLE `commands` ADD `target_mode` text DEFAULT 'optional' NOT NULL;--> statement-breakpoint
ALTER TABLE `commands` ADD `target_fallback` text DEFAULT 'de streamer' NOT NULL;