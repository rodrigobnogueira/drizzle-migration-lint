import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderGithub, renderGithubAnnotations, renderGithubSummary } from '../../src/reporters/github';
import type { Finding, LintResult } from '../../src/types';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    rule: 'drop-table',
    severity: 'warn',
    message: 'Dropping "posts" breaks readers.',
    suggestion: 'deploy first',
    file: '0001_x.sql',
    line: 3,
    migration: '0001_x',
    suppressed: false,
    docsUrl: 'https://x/#drop-table',
    ...over,
  };
}

function result(findings: Finding[]): LintResult {
  const active = findings.filter((f) => !f.suppressed);
  return {
    findings,
    diagnostics: [],
    summary: {
      errors: active.filter((f) => f.severity === 'error').length,
      warnings: active.filter((f) => f.severity === 'warn').length,
      suppressed: findings.length - active.length,
      migrationsChecked: 1,
    },
  };
}

test('annotations use the right level and escape data + properties', () => {
  const out = renderGithubAnnotations(
    result([
      finding({ severity: 'error', rule: 'set-not-null', message: 'a, b\nc', file: 'a:b.sql' }),
    ]),
  );
  assert.match(out, /^::error file=a%3Ab\.sql,line=3,title=drizzle-migration-lint\(set-not-null\)::/);
  // in the data body only %, CR, LF are escaped (commas stay); properties escape more
  assert.match(out, /::a, b%0Ac /);
});

test('warnings render as ::warning and suppressed findings are omitted', () => {
  const out = renderGithubAnnotations(result([finding(), finding({ suppressed: true, line: 9 })]));
  const lines = out.split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^::warning /);
});

test('the summary table lists active findings and escapes pipes', () => {
  const table = renderGithubSummary(result([finding({ message: 'has | pipe' })]));
  assert.match(table, /### drizzle-migration-lint/);
  assert.match(table, /\| warn \| drop-table \| 0001_x\.sql \| 3 \| has \\\| pipe \|/);
});

test('the summary omits the table when there is nothing active', () => {
  const table = renderGithubSummary(result([]));
  assert.doesNotMatch(table, /Severity/);
  assert.match(table, /0 error\(s\)/);
});

test('renderGithub appends the summary only when $GITHUB_STEP_SUMMARY is set', () => {
  const writes: { path: string; data: string }[] = [];
  const append = (path: string, data: string) => writes.push({ path, data });

  const withEnv = renderGithub(result([finding()]), { GITHUB_STEP_SUMMARY: '/tmp/summary' }, append);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.path, '/tmp/summary');
  assert.match(withEnv, /^::warning /);

  const withoutEnv = renderGithub(result([finding()]), {}, append);
  assert.equal(writes.length, 1); // unchanged — no append
  assert.match(withoutEnv, /^::warning /);
});
