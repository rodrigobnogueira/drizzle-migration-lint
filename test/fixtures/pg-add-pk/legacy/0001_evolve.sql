ALTER TABLE "users" ADD PRIMARY KEY ("code");--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "code" SET NOT NULL;