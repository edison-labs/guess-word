CREATE TABLE `game_access_tokens` (
	`game_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `token_hash`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
