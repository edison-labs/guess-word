CREATE TABLE `account_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`player_id` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_sessions_token_hash_unique` ON `account_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_account_sessions_token` ON `account_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_hash` text NOT NULL,
	`phone_last4` text NOT NULL,
	`nickname` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone_hash_unique` ON `users` (`phone_hash`);--> statement-breakpoint
CREATE TABLE `verification_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`phone_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_verification_phone_created` ON `verification_codes` (`phone_hash`,`created_at`);--> statement-breakpoint
ALTER TABLE `games` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `games` ADD `challenge_root_game_id` text;--> statement-breakpoint
CREATE INDEX `idx_games_owner_ended` ON `games` (`owner_id`,`ended_at`);--> statement-breakpoint
CREATE INDEX `idx_games_daily_rank` ON `games` (`daily_date`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_games_challenge_rank` ON `games` (`challenge_root_game_id`,`started_at`);