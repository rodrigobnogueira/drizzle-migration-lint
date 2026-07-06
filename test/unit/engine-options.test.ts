import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lint } from '../../src/engine';
import { splitStatements } from '../../src/splitter';
import type { Migration, MigrationSet } from '../../src/types';

function migration(id: string, sql: string): Migration {
  return {
    id, index: 0, sqlPath: `${id}.sql`, sql, statements: splitStatements(sql),
    snapshot: null, prevSnapshot: null, isFirst: false,
  };
}

function makeSet(migrations: Migration[]): MigrationSet {
  return { format: 'v1', dialect: 'mysql', dir: '/x', migrations, diagnostics: [] };
}

test('severity override "off" drops a rule\'s findings entirely', async () => {
  const set = makeSet([migration('m', 'TRUNCATE `users`;')]);
  const result = await lint(set, { severityOverrides: { 'truncate-in-migration': 'off' } });
  assert.equal(result.findings.length, 0);
  assert.equal(result.summary.warnings, 0);
});

test('severity override remaps a warning to an error', async () => {
  const set = makeSet([migration('m', 'TRUNCATE `users`;')]);
  const result = await lint(set, { severityOverrides: { 'truncate-in-migration': 'error' } });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.severity, 'error');
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.warnings, 0);
});

test('inScope skips out-of-scope migrations', async () => {
  const set = makeSet([migration('old', 'TRUNCATE `a`;'), migration('new', 'TRUNCATE `b`;')]);
  const result = await lint(set, { inScope: (id) => id === 'new' });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]!.migration, 'new');
  assert.equal(result.summary.migrationsChecked, 2); // total, not just scoped
});

test('extraDiagnostics from scope are surfaced in the result', async () => {
  const set = makeSet([migration('m', 'SELECT 1;')]);
  const result = await lint(set, {
    extraDiagnostics: [{ code: 'baseline-stale', message: 'stale' }],
  });
  assert.ok(result.diagnostics.some((d) => d.code === 'baseline-stale'));
});
