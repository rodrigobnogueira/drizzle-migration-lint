import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffMigration } from '../../src/differ';
import { splitStatements } from '../../src/splitter';
import type { Migration, RenameHints, Snapshot } from '../../src/types';
import { makeSnapshot } from '../support/tmp';

function mig(prev: Snapshot | null, next: Snapshot | null, sql: string): Migration {
  return {
    id: 'm',
    index: 1,
    sqlPath: 'm.sql',
    sql,
    statements: splitStatements(sql),
    snapshot: next,
    prevSnapshot: prev,
    isFirst: prev === null,
  };
}

test('no snapshot pair → no structural ops', () => {
  assert.deepEqual(diffMigration(mig(null, makeSnapshot('a', { users: [] }), '')), []);
  assert.deepEqual(diffMigration(mig(makeSnapshot('a', { users: [] }), null, '')), []);
});

test('drop-table: a table present in prev but gone in next', () => {
  const prev = makeSnapshot('a', { users: ['id'], posts: ['id'] });
  const next = makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] });
  const ops = diffMigration(mig(prev, next, 'DROP TABLE "posts";'));
  assert.deepEqual(ops, [{ kind: 'drop-table', table: 'posts', line: 1 }]);
});

test('drop-column: a column present in prev-table but gone in next', () => {
  const prev = makeSnapshot('a', { users: ['id', 'email'] });
  const next = makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] });
  const ops = diffMigration(mig(prev, next, 'ALTER TABLE "users" DROP COLUMN "email";'));
  assert.deepEqual(ops, [{ kind: 'drop-column', table: 'users', column: 'email', line: 1 }]);
});

test('rename-table from SQL, and it is NOT also reported as a drop', () => {
  const prev = makeSnapshot('a', { users: ['id'] });
  const next = makeSnapshot('b', { accounts: ['id'] }, { prevIds: ['a'] });
  const ops = diffMigration(mig(prev, next, 'ALTER TABLE "users" RENAME TO "accounts";'));
  assert.deepEqual(ops, [{ kind: 'rename-table', from: 'users', to: 'accounts', line: 1 }]);
});

test('rename-column from SQL, and it is NOT also reported as a drop', () => {
  const prev = makeSnapshot('a', { users: ['id', 'full_name'] });
  const next = makeSnapshot('b', { users: ['id', 'display_name'] }, { prevIds: ['a'] });
  const ops = diffMigration(
    mig(prev, next, 'ALTER TABLE "users" RENAME COLUMN "full_name" TO "display_name";'),
  );
  assert.deepEqual(ops, [
    { kind: 'rename-column', table: 'users', from: 'full_name', to: 'display_name', line: 1 },
  ]);
});

test('rename-column resolved from a snapshot hint alone (sqlite recreate dance)', () => {
  const renames: RenameHints = {
    tables: [],
    columns: [{ table: 'users', from: 'full_name', to: 'display_name' }],
  };
  const prev = makeSnapshot('a', { users: ['id', 'full_name'] });
  const next = makeSnapshot('b', { users: ['id', 'display_name'] }, { prevIds: ['a'], renames });
  // sqlite recreate: no clean RENAME statement, so the SQL carries the whole dance
  const dance =
    'CREATE TABLE "__new_users" ("id" integer, "display_name" text);--> statement-breakpoint\n' +
    'INSERT INTO "__new_users" SELECT * FROM "users";--> statement-breakpoint\n' +
    'DROP TABLE "users";--> statement-breakpoint\n' +
    'ALTER TABLE "__new_users" RENAME TO "users";';
  const ops = diffMigration(mig(prev, next, dance));
  assert.deepEqual(ops, [
    { kind: 'rename-column', table: 'users', from: 'full_name', to: 'display_name', line: 1 },
  ]);
});

test('__new_ table-recreate rename is not reported as a real table rename', () => {
  const prev = makeSnapshot('a', { users: ['id'] });
  const next = makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] });
  const ops = diffMigration(mig(prev, next, 'ALTER TABLE "__new_users" RENAME TO "users";'));
  assert.deepEqual(ops, []);
});

test('renaming a table created in the same migration is exempt (from side not in prev)', () => {
  const prev = makeSnapshot('a', {});
  const next = makeSnapshot('b', { accounts: ['id'] }, { prevIds: ['a'] });
  const ops = diffMigration(
    mig(prev, next, 'CREATE TABLE "users" ("id" serial);--> statement-breakpoint\nALTER TABLE "users" RENAME TO "accounts";'),
  );
  assert.deepEqual(ops, []);
});

test('SQL and snapshot hint agreeing on a rename produce a single op (dedup)', () => {
  const renames: RenameHints = { tables: [{ from: 'users', to: 'accounts' }], columns: [] };
  const prev = makeSnapshot('a', { users: ['id'] });
  const next = makeSnapshot('b', { accounts: ['id'] }, { prevIds: ['a'], renames });
  const ops = diffMigration(mig(prev, next, 'ALTER TABLE "users" RENAME TO "accounts";'));
  assert.equal(ops.length, 1);
  assert.equal(ops[0]!.kind, 'rename-table');
});

test('a table and one of its columns renamed in the same migration (column keyed by old name)', () => {
  const prev = makeSnapshot('a', { users: ['id', 'full_name'] });
  const next = makeSnapshot('b', { accounts: ['id', 'display_name'] }, { prevIds: ['a'] });
  // column rename references the OLD table name, before the table rename
  const sql =
    'ALTER TABLE "users" RENAME COLUMN "full_name" TO "display_name";--> statement-breakpoint\n' +
    'ALTER TABLE "users" RENAME TO "accounts";';
  const ops = diffMigration(mig(prev, next, sql));
  const kinds = ops.map((op) => op.kind).sort();
  assert.deepEqual(kinds, ['rename-column', 'rename-table']);
  const col = ops.find((op) => op.kind === 'rename-column')!;
  assert.equal((col as { table: string }).table, 'accounts');
});

test('drop-column line is located from the DROP COLUMN statement', () => {
  const prev = makeSnapshot('a', { users: ['id', 'email'] });
  const next = makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] });
  const sql = 'SELECT 1;--> statement-breakpoint\nALTER TABLE "users" DROP COLUMN "email";';
  const ops = diffMigration(mig(prev, next, sql));
  assert.equal(ops[0]!.line, 2);
});

test('an op with no matching statement falls back to line 1', () => {
  // snapshot says a column vanished but the SQL does not spell out a DROP COLUMN
  const prev = makeSnapshot('a', { users: ['id', 'email'] });
  const next = makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] });
  const ops = diffMigration(mig(prev, next, 'SELECT 1;'));
  assert.equal(ops[0]!.line, 1);
});

test('each dropped column is located at its own DROP COLUMN line', () => {
  const prev = makeSnapshot('a', { users: ['id', 'email', 'phone'] });
  const next = makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] });
  const sql =
    'ALTER TABLE "users" DROP COLUMN "email";--> statement-breakpoint\n' +
    'ALTER TABLE "users" DROP COLUMN "phone";';
  const ops = diffMigration(mig(prev, next, sql));
  const byColumn = new Map(
    ops.filter((op) => op.kind === 'drop-column').map((op) => [(op as { column: string }).column, op.line]),
  );
  assert.equal(byColumn.get('email'), 1);
  assert.equal(byColumn.get('phone'), 2);
});

test('a drop-column on a different table does not borrow another table’s line', () => {
  const prev = makeSnapshot('a', { users: ['id', 'email'], posts: ['id'] });
  const next = makeSnapshot('b', { users: ['id'], posts: ['id'] }, { prevIds: ['a'] });
  // a DROP COLUMN "email" that belongs to a different table must not match
  const sql = 'ALTER TABLE "accounts" DROP COLUMN "email";';
  const ops = diffMigration(mig(prev, next, sql));
  assert.equal(ops[0]!.line, 1); // no ALTER TABLE "users" statement → fallback
});
