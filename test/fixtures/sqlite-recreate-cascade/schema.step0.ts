// A parent with a child that references it ON DELETE CASCADE. Changing the
// parent in step1 forces SQLite's table-recreate (DROP + rebuild), whose
// implicit DELETE cascades to the child — the #4938 hazard on Cloudflare D1.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const parent = sqliteTable('parent', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: integer('code'),
});

export const child = sqliteTable('child', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parentId: integer('parent_id').references(() => parent.id, { onDelete: 'cascade' }),
});
