import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull(),
    name: text('name').notNull(),
  },
  (table) => [index('users_email_idx').on(table.email)],
);

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  authorId: integer('author_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
});
