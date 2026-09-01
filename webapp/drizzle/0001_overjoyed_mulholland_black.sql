CREATE TABLE `guess_claims` (
	`game_id` text NOT NULL,
	`normalized_guess` text NOT NULL,
	`claim_token` text NOT NULL,
	`claimed_at` integer NOT NULL,
	PRIMARY KEY(`game_id`, `normalized_guess`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
