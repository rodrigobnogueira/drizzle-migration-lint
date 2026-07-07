// parent.code changes integer → text. SQLite can't ALTER a column type in
// place, so drizzle-kit rebuilds `parent` (CREATE __new_parent → DROP TABLE
// parent → RENAME), and the child's ON DELETE CASCADE fires during the drop.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const parent = sqliteTable('parent', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code'),
});

export const child = sqliteTable('child', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parentId: integer('parent_id').references(() => parent.id, { onDelete: 'cascade' }),
});
