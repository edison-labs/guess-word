ALTER TABLE `guesses` ADD `score_milli_percent` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `guesses` SET `score_milli_percent` = `score_tenths` * 100;--> statement-breakpoint
CREATE INDEX `idx_guesses_game_score_milli` ON `guesses` (`game_id`,`score_milli_percent`,`sequence`);
