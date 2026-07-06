import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareFindings, computeNewTables, lint } from '../../src/engine';
import { splitStatements } from '../../src/splitter';
import type { Finding, Migration, MigrationSet, Snapshot } from '../../src/types';

function snapshot(id: string, tables: string[], prevIds: string[] = []): Snapshot {
  return { id, prevIds, tables: new Set(tables) };
}

function migration(partial: Partial<Migration> & { sql: string }): Migration {
  return {
    id: partial.id ?? 'm',
    index: partial.index ?? 0,
    sqlPath: partial.sqlPath ?? 'm.sql',
    sql: partial.sql,
    statements: splitStatements(partial.sql),
    snapshot: partial.snapshot ?? null,
    prevSnapshot: partial.prevSnapshot ?? null,
    isFirst: partial.isFirst ?? false,
  };
}

test('first migration: every table in the snapshot is new', () => {
  const m = migration({ sql: '', isFirst: true, snapshot: snapshot('a', ['users', 'posts']) });
  assert.deepEqual([...computeNewTables(m)].sort(), ['posts', 'users']);
});

test('later migration: new = snapshot minus predecessor', () => {
  const m = migration({
    sql: '',
    snapshot: snapshot('b', ['users', 'audit'], ['a']),
    prevSnapshot: snapshot('a', ['users']),
  });
  assert.deepEqual([...computeNewTables(m)], ['audit']);
});

test('no usable snapshots: falls back to harvesting CREATE TABLE from SQL', () => {
  const m = migration({
    sql:
      'CREATE TABLE "users" ("id" int);--> statement-breakpoint\n' +
      'CREATE TABLE IF NOT EXISTS "auth"."sessions" ("id" int);--> statement-breakpoint\n' +
      'ALTER TABLE "other" ADD COLUMN "x" int;',
  });
  assert.deepEqual([...computeNewTables(m)].sort(), ['auth.sessions', 'users']);
});

function makeSet(migrations: Migration[], dialect: MigrationSet['dialect']): MigrationSet {
  return { format: 'v1', dialect, dir: '/x', migrations, diagnostics: [] };
}

test('lint runs dialect-applicable rules and counts findings', () => {
  const m = migration({ sql: 'TRUNCATE "users";', id: 'mig-1', sqlPath: 'mig-1/migration.sql' });
  const result = lint(makeSet([m], 'postgresql'));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.rule, 'truncate-in-migration');
  assert.equal(result.summary.warnings, 1);
  assert.equal(result.summary.errors, 0);
  assert.equal(result.summary.suppressed, 0);
  assert.equal(result.summary.migrationsChecked, 1);
});

test('lint skips rules whose dialect does not match', () => {
  const m = migration({ sql: 'TRUNCATE "users";' });
  const result = lint(makeSet([m], 'sqlite'));
  assert.equal(result.findings.length, 0);
});

test('findings are sorted by file, then line, then rule', () => {
  const first = migration({ sql: 'TRUNCATE "a";\nSELECT 1;--> statement-breakpoint\nTRUNCATE "b";', id: '1', sqlPath: 'a.sql' });
  const second = migration({ sql: 'TRUNCATE "c";', id: '2', sqlPath: 'b.sql', index: 1 });
  const result = lint(makeSet([second, first], 'postgresql'));
  assert.deepEqual(
    result.findings.map((f) => `${f.file}:${f.line}`),
    ['a.sql:1', 'a.sql:3', 'b.sql:1'],
  );
});

test('compareFindings orders by file, then line, then rule id', () => {
  const f = (file: string, line: number, rule: string): Finding =>
    ({ file, line, rule } as Finding);
  // file dominates
  assert.ok(compareFindings(f('a.sql', 9, 'z'), f('b.sql', 1, 'a')) < 0);
  // same file → line dominates
  assert.ok(compareFindings(f('a.sql', 5, 'z'), f('a.sql', 2, 'a')) > 0);
  // same file + line → rule id breaks the tie
  assert.ok(compareFindings(f('a.sql', 3, 'add-fk'), f('a.sql', 3, 'set-not-null')) < 0);
  assert.equal(compareFindings(f('a.sql', 3, 'r'), f('a.sql', 3, 'r')), 0);
});
