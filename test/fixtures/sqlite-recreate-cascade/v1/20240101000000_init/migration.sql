CREATE TABLE `child` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`parent_id` integer,
	CONSTRAINT `fk_child_parent_id_parent_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `parent`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `parent` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`code` integer
);
