CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`author_id` integer NOT NULL,
	`title` text NOT NULL,
	CONSTRAINT `fk_posts_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`email` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);