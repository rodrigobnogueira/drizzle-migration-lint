CREATE TABLE "posts" (
	"id" serial PRIMARY KEY,
	"author_id" integer NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"email" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" ("email");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id");