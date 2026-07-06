import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lint } from '../../src/engine';
import { splitStatements } from '../../src/splitter';
import type { Dialect, Finding, LintResult, Snapshot } from '../../src/types';
import { makeSnapshot } from '../support/tmp';

async function lintOne(prev: Snapshot, next: Snapshot, sql: string, dialect: Dialect = 'postgresql'): Promise<LintResult> {
  return lint({
    format: 'v1',
    dialect,
    dir: '/x',
    migrations: [
      {
        id: 'm1',
        index: 1,
        sqlPath: 'm1.sql',
        sql,
        statements: splitStatements(sql),
        snapshot: next,
        prevSnapshot: prev,
        isFirst: false,
      },
    ],
    diagnostics: [],
  });
}

function one(result: LintResult, rule: string): Finding {
  const matches = result.findings.filter((f) => f.rule === rule);
  assert.equal(matches.length, 1, `expected exactly one ${rule} finding`);
  return matches[0]!;
}

test('drop-table produces a warn finding with the rolling-deploy suggestion', async () => {
  const result = await lintOne(
    makeSnapshot('a', { users: ['id'], posts: ['id'] }),
    makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] }),
    'DROP TABLE "posts";',
  );
  const finding = one(result, 'drop-table');
  assert.equal(finding.severity, 'warn');
  assert.match(finding.message, /Dropping table "posts"/);
  assert.match(finding.suggestion, /deploy everywhere first/);
  assert.match(finding.docsUrl, /#drop-table$/);
  assert.equal(finding.line, 1);
});

test('drop-column produces a warn finding naming the column and table', async () => {
  const result = await lintOne(
    makeSnapshot('a', { users: ['id', 'email'] }),
    makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] }),
    'ALTER TABLE "users" DROP COLUMN "email";',
  );
  const finding = one(result, 'drop-column');
  assert.match(finding.message, /Dropping column "email" from "users"/);
  assert.match(finding.docsUrl, /#drop-column$/);
});

test('rename-table produces a warn finding with the view bridge hint', async () => {
  const result = await lintOne(
    makeSnapshot('a', { users: ['id'] }),
    makeSnapshot('b', { accounts: ['id'] }, { prevIds: ['a'] }),
    'ALTER TABLE "users" RENAME TO "accounts";',
  );
  const finding = one(result, 'rename-table');
  assert.match(finding.message, /Renaming table "users" to "accounts"/);
  assert.match(finding.suggestion, /updatable view named "users"/);
});

test('rename-column produces a warn finding', async () => {
  const result = await lintOne(
    makeSnapshot('a', { users: ['id', 'full_name'] }),
    makeSnapshot('b', { users: ['id', 'display_name'] }, { prevIds: ['a'] }),
    'ALTER TABLE "users" RENAME COLUMN "full_name" TO "display_name";',
  );
  const finding = one(result, 'rename-column');
  assert.match(finding.message, /Renaming column "full_name" to "display_name" on "users"/);
});

test('structural rules fire on non-postgres dialects too (sqlite)', async () => {
  const result = await lintOne(
    makeSnapshot('a', { users: ['id'], posts: ['id'] }),
    makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] }),
    'DROP TABLE `posts`;',
    'sqlite',
  );
  assert.equal(one(result, 'drop-table').severity, 'warn');
});

test('a disable-next-statement directive suppresses the drop but keeps it counted', async () => {
  const result = await lintOne(
    makeSnapshot('a', { users: ['id', 'email'] }),
    makeSnapshot('b', { users: ['id'] }, { prevIds: ['a'] }),
    '-- drizzle-migration-lint:disable-next-statement drop-column intentional\n' +
      'ALTER TABLE "users" DROP COLUMN "email";',
  );
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.suppressed, true);
  assert.equal(result.summary.warnings, 0);
  assert.equal(result.summary.suppressed, 1);
});

test('a clean add-only migration yields no structural findings', async () => {
  const result = await lintOne(
    makeSnapshot('a', { users: ['id'] }),
    makeSnapshot('b', { users: ['id', 'email'] }, { prevIds: ['a'] }),
    'ALTER TABLE "users" ADD COLUMN "email" text;',
  );
  assert.equal(result.findings.length, 0);
});
