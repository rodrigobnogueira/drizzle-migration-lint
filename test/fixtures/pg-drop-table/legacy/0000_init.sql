CREATE TABLE "legacy_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
