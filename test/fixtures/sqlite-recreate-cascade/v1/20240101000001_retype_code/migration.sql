PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_parent` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`code` text
);
--> statement-breakpoint
INSERT INTO `__new_parent`(`id`, `code`) SELECT `id`, `code` FROM `parent`;--> statement-breakpoint
DROP TABLE `parent`;--> statement-breakpoint
ALTER TABLE `__new_parent` RENAME TO `parent`;--> statement-breakpoint
PRAGMA foreign_keys=ON;