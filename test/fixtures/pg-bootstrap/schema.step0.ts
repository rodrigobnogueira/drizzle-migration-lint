// Flagship zero-findings case: a bootstrap migration full of operations that
// WOULD flag on pre-existing tables (plain index, NOT NULL without default,
// FK) — all exempt because every table is new in this migration.
import { index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
  },
  (table) => [index('users_email_idx').on(table.email)],
);

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
});
