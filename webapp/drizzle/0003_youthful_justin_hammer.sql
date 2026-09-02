CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_key` text NOT NULL,
	`question_id` text NOT NULL,
	`normalized_guess` text NOT NULL,
	`prompt_tokens` integer NOT NULL,
	`cached_prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`estimated_cost_microusd` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `score_feedback` (
	`game_id` text NOT NULL,
	`normalized_guess` text NOT NULL,
	`direction` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `normalized_guess`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `semantic_scores` (
	`provider_key` text NOT NULL,
	`question_id` text NOT NULL,
	`normalized_guess` text NOT NULL,
	`score_milli_percent` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`provider_key`, `question_id`, `normalized_guess`)
);
--> statement-breakpoint
ALTER TABLE `games` ADD `mode` text DEFAULT 'random' NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `daily_date` text;