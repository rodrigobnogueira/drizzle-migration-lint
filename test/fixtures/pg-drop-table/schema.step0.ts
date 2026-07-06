import { pgTable, serial, text } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

export const legacyLogs = pgTable('legacy_logs', {
  id: serial('id').primaryKey(),
  message: text('message').notNull(),
});
