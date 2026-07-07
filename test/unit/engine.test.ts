import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_SIZE_THRESHOLD,
  applySizeExemptions,
  compareFindings,
  computeNewTables,
  lint,
} from '../../src/engine';
import { splitStatements } from '../../src/splitter';
import type { Finding, Migration, MigrationSet, Snapshot } from '../../src/types';

function snapshot(id: string, tables: string[], prevIds: string[] = []): Snapshot {
  const map = new Map(
    tables.map((t) => [t, { identity: t, name: t, schema: null, columns: new Map() }] as const),
  );
  return { id, prevIds, tables: map, renames: { tables: [], columns: [] } };
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

test('lint runs dialect-applicable rules and counts findings', async () => {
  const m = migration({ sql: 'TRUNCATE "users";', id: 'mig-1', sqlPath: 'mig-1/migration.sql' });
  const result = await lint(makeSet([m], 'postgresql'));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.rule, 'truncate-in-migration');
  assert.equal(result.summary.warnings, 1);
  assert.equal(result.summary.errors, 0);
  assert.equal(result.summary.suppressed, 0);
  assert.equal(result.summary.migrationsChecked, 1);
});

test('lint skips rules whose dialect does not match', async () => {
  const m = migration({ sql: 'TRUNCATE "users";' });
  const result = await lint(makeSet([m], 'sqlite'));
  assert.equal(result.findings.length, 0);
});

test('findings are sorted by file, then line, then rule', async () => {
  const first = migration({ sql: 'TRUNCATE "a";\nSELECT 1;--> statement-breakpoint\nTRUNCATE "b";', id: '1', sqlPath: 'a.sql' });
  const second = migration({ sql: 'TRUNCATE "c";', id: '2', sqlPath: 'b.sql', index: 1 });
  const result = await lint(makeSet([second, first], 'postgresql'));
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

// ---------- size-exemption ----------

function sizeFinding(over: Partial<Finding>): Finding {
  return {
    rule: 'create-index-non-concurrently',
    severity: 'error',
    message: 'm',
    suggestion: 's',
    file: 'f.sql',
    line: 1,
    migration: 'x',
    suppressed: false,
    table: 'users',
    docsUrl: 'd',
    ...over,
  };
}

test('size-exemption suppresses a size-sensitive finding on a small table', () => {
  const findings = [sizeFinding({})];
  applySizeExemptions(findings, new Map([['users', 1000]]), DEFAULT_SIZE_THRESHOLD);
  assert.equal(findings[0]!.suppressed, true);
  assert.match(findings[0]!.message, /the lock is brief/);
});

test('size-exemption keeps a finding on a table above the threshold', () => {
  const findings = [sizeFinding({})];
  applySizeExemptions(findings, new Map([['users', 999_999_999]]), DEFAULT_SIZE_THRESHOLD);
  assert.equal(findings[0]!.suppressed, false);
});

test('size-exemption keeps a finding on a table not in the size map', () => {
  const findings = [sizeFinding({})];
  applySizeExemptions(findings, new Map(), 10);
  assert.equal(findings[0]!.suppressed, false);
});

test('size-exemption skips non-size-sensitive, tableless, and already-suppressed findings', () => {
  const notSensitive = sizeFinding({ rule: 'add-enum-value' });
  const tableless = sizeFinding({ table: undefined });
  const already = sizeFinding({ suppressed: true, message: 'kept' });
  applySizeExemptions([notSensitive, tableless, already], new Map([['users', 1]]), 10);
  assert.equal(notSensitive.suppressed, false);
  assert.equal(tableless.suppressed, false);
  assert.equal(already.message, 'kept'); // untouched
});

test('lint threads tableSizes through to size-exemption', async () => {
  const m = migration({ sql: 'CREATE INDEX "i" ON "users" ("x");' });
  const result = await lint(makeSet([m], 'postgresql'), { tableSizes: new Map([['users', 1000]]) });
  const finding = result.findings.find((f) => f.rule === 'create-index-non-concurrently')!;
  assert.equal(finding.suppressed, true);
  assert.equal(result.summary.suppressed, 1);
  assert.equal(result.summary.errors, 0);
});
