import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, serial, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', { id: serial('id').primaryKey() });
export const posts = pgTable('posts', { id: serial('id').primaryKey(), authorId: integer('author_id').references(() => users.id) });
