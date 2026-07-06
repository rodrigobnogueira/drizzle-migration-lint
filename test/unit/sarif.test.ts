import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSarif } from '../../src/reporters/sarif';
import type { Finding, LintResult } from '../../src/types';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    rule: 'create-index-non-concurrently',
    severity: 'error',
    message: 'msg',
    suggestion: 'do this instead',
    file: '0001_x/migration.sql',
    line: 4,
    migration: '0001_x',
    suppressed: false,
    docsUrl: 'https://example/docs#create-index-non-concurrently',
    ...over,
  };
}

function result(findings: Finding[]): LintResult {
  return { findings, diagnostics: [], summary: { errors: 0, warnings: 0, suppressed: 0, migrationsChecked: 1 } };
}

test('renders valid SARIF 2.1.0 with tool + results', () => {
  const sarif = JSON.parse(
    renderSarif(result([finding(), finding({ rule: 'drop-column', severity: 'warn', line: 2 })])),
  );
  assert.equal(sarif.version, '2.1.0');
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, 'drizzle-migration-lint');
  assert.equal(run.results.length, 2);
  assert.equal(run.results[0].level, 'error');
  assert.equal(run.results[1].level, 'warning');
  assert.equal(run.results[0].locations[0].physicalLocation.artifactLocation.uri, '0001_x/migration.sql');
  assert.equal(run.results[0].locations[0].physicalLocation.region.startLine, 4);
  assert.match(run.results[0].message.text, /do this instead/);
  // rules described once per distinct rule, with helpUri
  assert.equal(run.tool.driver.rules.length, 2);
  assert.equal(run.tool.driver.rules[0].helpUri, 'https://example/docs#create-index-non-concurrently');
});

test('marks suppressed findings with a SARIF suppression', () => {
  const sarif = JSON.parse(renderSarif(result([finding({ suppressed: true })])));
  assert.deepEqual(sarif.runs[0].results[0].suppressions, [{ kind: 'inSource' }]);
});

test('a clean run is still valid SARIF (empty results and rules)', () => {
  const sarif = JSON.parse(renderSarif(result([])));
  assert.deepEqual(sarif.runs[0].results, []);
  assert.deepEqual(sarif.runs[0].tool.driver.rules, []);
});

test('the same rule twice is described once', () => {
  const sarif = JSON.parse(renderSarif(result([finding(), finding({ line: 9 })])));
  assert.equal(sarif.runs[0].tool.driver.rules.length, 1);
  assert.equal(sarif.runs[0].results.length, 2);
});
