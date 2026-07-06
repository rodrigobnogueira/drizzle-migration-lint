import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySuppressions, parseDirectives } from '../../src/suppressions';
import { splitStatements } from '../../src/splitter';
import type { Finding } from '../../src/types';

function finding(rule: string, line: number): Finding {
  return {
    rule: rule as Finding['rule'],
    severity: 'warn',
    message: '',
    suggestion: '',
    file: 'm.sql',
    line,
    migration: 'm',
    suppressed: false,
    docsUrl: '',
  };
}

test('parseDirectives reads both kinds with their line and rule ids', () => {
  const sql =
    '-- drizzle-migration-lint:disable-file drop-table\n' +
    'DROP TABLE "a";--> statement-breakpoint\n' +
    '-- drizzle-migration-lint:disable-next-statement drop-column,rename-column keep for now\n' +
    'ALTER TABLE "b" DROP COLUMN "c";';
  const directives = parseDirectives(sql);
  assert.equal(directives.length, 2);
  assert.deepEqual(directives[0], { kind: 'disable-file', rules: new Set(['drop-table']), line: 1 });
  assert.equal(directives[1]!.kind, 'disable-next-statement');
  assert.deepEqual([...directives[1]!.rules!].sort(), ['drop-column', 'rename-column']);
  assert.equal(directives[1]!.line, 3);
});

test('a directive with no rule ids means "all rules"', () => {
  const [directive] = parseDirectives('-- drizzle-migration-lint:disable-file just because');
  assert.equal(directive!.rules, null);
});

test('a directive whose first token is prose (not an id list) means all rules', () => {
  const [directive] = parseDirectives('-- drizzle-migration-lint:disable-file this is only a reason');
  assert.equal(directive!.rules, null);
});

test('disable-file suppresses matching findings across the whole file', () => {
  const findings = [finding('drop-table', 2), finding('drop-column', 4)];
  applySuppressions(findings, '-- drizzle-migration-lint:disable-file drop-table', []);
  assert.equal(findings[0]!.suppressed, true);
  assert.equal(findings[1]!.suppressed, false);
});

test('disable-file with no ids suppresses every finding', () => {
  const findings = [finding('drop-table', 2), finding('rename-column', 4)];
  applySuppressions(findings, '-- drizzle-migration-lint:disable-file', []);
  assert.ok(findings.every((f) => f.suppressed));
});

test('disable-next-statement suppresses only the following statement', () => {
  const sql =
    'DROP TABLE "keep_me";--> statement-breakpoint\n' +
    '-- drizzle-migration-lint:disable-next-statement drop-table\n' +
    'DROP TABLE "silence_me";';
  const statements = splitStatements(sql);
  // statement lines: "keep_me" at 1, "silence_me" at 3 (comment on line 2 skipped)
  const findings = [finding('drop-table', 1), finding('drop-table', 3)];
  applySuppressions(findings, sql, statements);
  assert.equal(findings[0]!.suppressed, false);
  assert.equal(findings[1]!.suppressed, true);
});

test('disable-next-statement respects the rule-id filter', () => {
  const sql =
    '-- drizzle-migration-lint:disable-next-statement rename-column\n' +
    'ALTER TABLE "t" DROP COLUMN "c";';
  const statements = splitStatements(sql);
  const findings = [finding('drop-column', 2)];
  applySuppressions(findings, sql, statements);
  // the directive names a different rule, so the drop-column finding survives
  assert.equal(findings[0]!.suppressed, false);
});

test('disable-next-statement with nothing after it is a no-op', () => {
  const findings = [finding('drop-table', 1)];
  applySuppressions(findings, '-- drizzle-migration-lint:disable-next-statement drop-table', []);
  assert.equal(findings[0]!.suppressed, false);
});
