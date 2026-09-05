CREATE TABLE `auth_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_failures_scope_created` ON `auth_failures` (`scope_key`,`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `username` text;--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_code_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);