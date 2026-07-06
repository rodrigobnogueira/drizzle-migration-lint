import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchRename, parseSqlRenames } from '../../src/sql-renames';
import { splitStatements } from '../../src/splitter';

function only(sql: string) {
  return matchRename(splitStatements(sql)[0]!);
}

test('matches a table rename', () => {
  assert.deepEqual(only('ALTER TABLE "users" RENAME TO "accounts";'), {
    from: 'users',
    to: 'accounts',
    line: 1,
  });
});

test('matches a table rename with IF EXISTS and schema qualification', () => {
  assert.deepEqual(only('ALTER TABLE IF EXISTS "auth"."users" RENAME TO "auth"."accounts";'), {
    from: 'auth.users',
    to: 'auth.accounts',
    line: 1,
  });
});

test('matches a column rename with the COLUMN keyword', () => {
  assert.deepEqual(only('ALTER TABLE "users" RENAME COLUMN "full_name" TO "display_name";'), {
    table: 'users',
    from: 'full_name',
    to: 'display_name',
    line: 1,
  });
});

test('matches a column rename without the COLUMN keyword (pg shorthand)', () => {
  assert.deepEqual(only('ALTER TABLE "users" RENAME "a" TO "b";'), {
    table: 'users',
    from: 'a',
    to: 'b',
    line: 1,
  });
});

test('a table rename is never misread as a column rename', () => {
  const rename = only('ALTER TABLE "users" RENAME TO "accounts";');
  assert.ok(rename && !('table' in rename));
});

test('returns null for non-rename statements', () => {
  assert.equal(only('ALTER TABLE "users" ADD COLUMN "x" text;'), null);
  assert.equal(only('DROP TABLE "users";'), null);
  assert.equal(only('CREATE TABLE "users" ("id" serial);'), null);
});

test('parseSqlRenames splits table and column renames and tracks lines', () => {
  const sql =
    'ALTER TABLE "users" RENAME TO "accounts";--> statement-breakpoint\n' +
    'ALTER TABLE "accounts" RENAME COLUMN "full_name" TO "display_name";';
  const { tables, columns } = parseSqlRenames(splitStatements(sql));
  assert.deepEqual(tables, [{ from: 'users', to: 'accounts', line: 1 }]);
  assert.deepEqual(columns, [{ table: 'accounts', from: 'full_name', to: 'display_name', line: 2 }]);
});

test('parseSqlRenames ignores unrelated statements', () => {
  const { tables, columns } = parseSqlRenames(splitStatements('DELETE FROM "users";'));
  assert.deepEqual(tables, []);
  assert.deepEqual(columns, []);
});
