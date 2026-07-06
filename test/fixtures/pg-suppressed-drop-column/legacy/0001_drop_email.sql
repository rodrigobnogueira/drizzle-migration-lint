-- drizzle-migration-lint:disable-file drop-column intentional, coordinated with a code deploy
ALTER TABLE "users" DROP COLUMN "email";