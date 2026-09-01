CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`resume_token_hash` text NOT NULL,
	`question_id` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`hint_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `guesses` (
	`game_id` text NOT NULL,
	`normalized_guess` text NOT NULL,
	`display_guess` text NOT NULL,
	`score_tenths` integer NOT NULL,
	`temperature` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `normalized_guess`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_guesses_game_sequence_unique` ON `guesses` (`game_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_guesses_game_sequence` ON `guesses` (`game_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_guesses_game_score` ON `guesses` (`game_id`,`score_tenths`,`sequence`);