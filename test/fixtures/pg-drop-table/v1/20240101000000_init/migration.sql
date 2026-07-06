CREATE TABLE "legacy_logs" (
	"id" serial PRIMARY KEY,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL
);
