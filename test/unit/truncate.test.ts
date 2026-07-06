import assert from 'node:assert/strict';
import { test } from 'node:test';
import { truncateInMigration } from '../../src/rules/universal/truncate-in-migration';
import { splitStatements } from '../../src/splitter';
import type { Migration, MigrationSet, RuleContext } from '../../src/types';

function contextFor(sql: string, newTables: string[] = []): RuleContext {
  const migration: Migration = {
    id: 'mig',
    index: 0,
    sqlPath: 'mig.sql',
    sql,
    statements: splitStatements(sql),
    snapshot: null,
    prevSnapshot: null,
    isFirst: false,
  };
  const set: MigrationSet = {
    format: 'v1',
    dialect: 'postgresql',
    dir: '/x',
    migrations: [migration],
    diagnostics: [],
  };
  return { set, migration, newTables: new Set(newTables), diffOps: [] };
}

test('flags plain TRUNCATE with the table named', () => {
  const findings = truncateInMigration.check(contextFor('TRUNCATE "users";'));
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /users/);
  assert.equal(findings[0]!.severity, 'warn');
  assert.match(findings[0]!.docsUrl, /#truncate-in-migration$/);
});

test('understands TABLE/ONLY keywords, multiple targets and tail options', () => {
  const findings = truncateInMigration.check(
    contextFor('TRUNCATE TABLE ONLY "public"."users", auth.sessions RESTART IDENTITY CASCADE;'),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /users, auth\.sessions/);
});

test('exempts tables created in the same migration', () => {
  const clean = truncateInMigration.check(contextFor('TRUNCATE "users";', ['users']));
  assert.equal(clean.length, 0);
});

test('flags when only some targets are new', () => {
  const findings = truncateInMigration.check(contextFor('TRUNCATE "users", "staging";', ['staging']));
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /\(users\)/);
});

test('an unparseable target still flags', () => {
  const findings = truncateInMigration.check(contextFor('TRUNCATE ;'));
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /unknown target/);
});

test('a bare TRUNCATE keyword (no target clause) still flags', () => {
  const findings = truncateInMigration.check(contextFor('TRUNCATE'));
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /unknown target/);
});

test('ignores non-TRUNCATE statements', () => {
  const findings = truncateInMigration.check(
    contextFor('CREATE TABLE "users" ("id" int);--> statement-breakpoint\nDELETE FROM "users";'),
  );
  assert.equal(findings.length, 0);
});
