CREATE TABLE `daily_participations` (
	`owner_id` text NOT NULL,
	`daily_date` text NOT NULL,
	`game_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `daily_date`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_daily_participations_game` ON `daily_participations` (`game_id`);--> statement-breakpoint
CREATE TABLE `question_progress` (
	`owner_id` text NOT NULL,
	`category` text NOT NULL,
	`question_id` text NOT NULL,
	`played_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `category`, `question_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_question_progress_owner_category` ON `question_progress` (`owner_id`,`category`);