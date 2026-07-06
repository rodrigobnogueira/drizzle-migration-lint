import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, serial, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', { code: integer('code') });
