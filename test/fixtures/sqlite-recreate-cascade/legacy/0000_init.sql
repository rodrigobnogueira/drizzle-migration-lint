CREATE TABLE `child` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	FOREIGN KEY (`parent_id`) REFERENCES `parent`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `parent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` integer
);
