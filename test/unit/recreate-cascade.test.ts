import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recreateCascadeDataLoss } from '../../src/rules/universal/recreate-cascade-data-loss';
import { splitStatements } from '../../src/splitter';
import type { Migration, MigrationSet, RuleContext, Snapshot } from '../../src/types';
import { makeSnapshot } from '../support/tmp';

/** A guarded recreate of `parent` (drizzle-kit's __new_ dance with PRAGMA). */
function recreateSql(guarded = true): string {
  const guardOff = guarded ? 'PRAGMA foreign_keys=OFF;--> statement-breakpoint\n' : '';
  const guardOn = guarded ? '\n--> statement-breakpoint\nPRAGMA foreign_keys=ON;' : '';
  return (
    guardOff +
    'CREATE TABLE `__new_parent` (`id` integer PRIMARY KEY, `code` text);--> statement-breakpoint\n' +
    'INSERT INTO `__new_parent`("id") SELECT "id" FROM `parent`;--> statement-breakpoint\n' +
    'DROP TABLE `parent`;--> statement-breakpoint\n' +
    'ALTER TABLE `__new_parent` RENAME TO `parent`;' +
    guardOn
  );
}

function ctxFor(sql: string, snapshot: Snapshot | null, newTables: string[] = []): RuleContext {
  const migration: Migration = {
    id: 'm',
    index: 1,
    sqlPath: 'm.sql',
    sql,
    statements: splitStatements(sql),
    snapshot,
    prevSnapshot: null,
    isFirst: false,
  };
  const set: MigrationSet = { format: 'v1', dialect: 'sqlite', dir: '/x', migrations: [migration], diagnostics: [] };
  return { set, migration, newTables: new Set(newTables), diffOps: [], pgStatements: [] };
}

function snapshotWithChild(onDelete: string): Snapshot {
  return makeSnapshot('s', { parent: ['id', 'code'], child: ['id', 'parent_id'] }, {
    foreignKeys: { child: [{ tableTo: 'parent', onDelete }] },
  });
}

test('guarded recreate with a cascade child → warn, D1 message, anchored to DROP', () => {
  const findings = recreateCascadeDataLoss.check(ctxFor(recreateSql(true), snapshotWithChild('cascade')));
  assert.equal(findings.length, 1);
  const f = findings[0]!;
  assert.equal(f.severity, 'warn');
  assert.equal(f.table, 'parent');
  assert.match(f.message, /"child"/);
  assert.match(f.message, /Cloudflare D1 ignores PRAGMA foreign_keys/);
  assert.match(f.message, /#4938/);
  assert.equal(f.line, 4); // the DROP TABLE line (after the PRAGMA + CREATE + INSERT)
});

test('unguarded recreate (no PRAGMA) → warn, all-SQLite message', () => {
  const findings = recreateCascadeDataLoss.check(ctxFor(recreateSql(false), snapshotWithChild('cascade')));
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /loses data on all SQLite/);
});

test('set null and set default are also flagged; no action / restrict are not', () => {
  assert.equal(recreateCascadeDataLoss.check(ctxFor(recreateSql(), snapshotWithChild('set null'))).length, 1);
  assert.equal(recreateCascadeDataLoss.check(ctxFor(recreateSql(), snapshotWithChild('set default'))).length, 1);
  assert.equal(recreateCascadeDataLoss.check(ctxFor(recreateSql(), snapshotWithChild('no action'))).length, 0);
  assert.equal(recreateCascadeDataLoss.check(ctxFor(recreateSql(), snapshotWithChild('restrict'))).length, 0);
});

test('a child created in the same migration is exempt (no rows to lose)', () => {
  const findings = recreateCascadeDataLoss.check(ctxFor(recreateSql(), snapshotWithChild('cascade'), ['child']));
  assert.equal(findings.length, 0);
});

test('a migration with no recreate produces nothing', () => {
  const sql = 'ALTER TABLE `parent` ADD COLUMN `note` text;';
  assert.equal(recreateCascadeDataLoss.check(ctxFor(sql, snapshotWithChild('cascade'))).length, 0);
});

test('a recreate with no cascading child produces nothing', () => {
  const snapshot = makeSnapshot('s', { parent: ['id'], child: ['id'] }); // child has no FK
  assert.equal(recreateCascadeDataLoss.check(ctxFor(recreateSql(), snapshot)).length, 0);
});

test('multiple cascading children are listed in one finding', () => {
  const snapshot = makeSnapshot('s', { parent: ['id'], a: ['id', 'p'], b: ['id', 'p'] }, {
    foreignKeys: { a: [{ tableTo: 'parent', onDelete: 'cascade' }], b: [{ tableTo: 'parent', onDelete: 'cascade' }] },
  });
  const findings = recreateCascadeDataLoss.check(ctxFor(recreateSql(), snapshot));
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /"a"/);
  assert.match(findings[0]!.message, /"b"/);
});

test('no snapshot → no findings', () => {
  assert.equal(recreateCascadeDataLoss.check(ctxFor(recreateSql(), null)).length, 0);
});

test('falls back to the RENAME line when the DROP is absent (hand-edited SQL)', () => {
  // only the rename marker, no DROP TABLE statement
  const sql = 'ALTER TABLE `__new_parent` RENAME TO `parent`;';
  const findings = recreateCascadeDataLoss.check(ctxFor(sql, snapshotWithChild('cascade')));
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.line, 1);
});

test('the rule reads FKs from prevSnapshot when the post snapshot is absent', () => {
  const prev = snapshotWithChild('cascade');
  const migration: Migration = {
    id: 'm', index: 1, sqlPath: 'm.sql', sql: recreateSql(),
    statements: splitStatements(recreateSql()), snapshot: null, prevSnapshot: prev, isFirst: false,
  };
  const set: MigrationSet = { format: 'v1', dialect: 'sqlite', dir: '/x', migrations: [migration], diagnostics: [] };
  const ctx: RuleContext = { set, migration, newTables: new Set(), diffOps: [], pgStatements: [] };
  assert.equal(recreateCascadeDataLoss.check(ctx).length, 1);
});
