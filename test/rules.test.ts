import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { lint } from '../src/engine';
import { readMigrationSet } from '../src/formats';
import type { ArtifactFormat, Finding } from '../src/types';

const FIXTURES_ROOT = join(__dirname, 'fixtures');
const FORMATS: ArtifactFormat[] = ['legacy', 'v1'];

interface ExpectedFinding {
  rule: string;
  migration?: string;
  line?: number;
}

/** Compare the fields a fixture asserts on — never the full object, so
 * message wording can evolve without touching every expected.json. */
function projectFinding(finding: Finding, keys: (keyof ExpectedFinding)[]): ExpectedFinding {
  const projected: ExpectedFinding = { rule: finding.rule };
  if (keys.includes('migration')) {
    projected.migration = finding.migration;
  }
  if (keys.includes('line')) {
    projected.line = finding.line;
  }
  return projected;
}

const caseNames = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const caseName of caseNames) {
  const caseDir = join(FIXTURES_ROOT, caseName);
  const expected = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf8'));
  for (const format of FORMATS) {
    const expectedForFormat = expected[format];
    if (!expectedForFormat) {
      continue;
    }
    test(`fixture ${caseName} [${format}]`, () => {
      const set = readMigrationSet(join(caseDir, format));
      const result = lint(set);
      const expectedFindings: ExpectedFinding[] = expectedForFormat.findings;
      const first = expectedFindings[0];
      const comparedKeys = first
        ? (Object.keys(first) as (keyof ExpectedFinding)[])
        : (['rule'] as (keyof ExpectedFinding)[]);
      assert.deepEqual(
        result.findings.filter((f) => !f.suppressed).map((f) => projectFinding(f, comparedKeys)),
        expectedFindings,
        `unexpected findings for ${caseName} [${format}]`,
      );
      if (expectedForFormat.diagnostics !== undefined) {
        assert.deepEqual(
          result.diagnostics.map((d) => d.code),
          expectedForFormat.diagnostics,
        );
      }
      if (expectedForFormat.suppressed !== undefined) {
        assert.equal(result.summary.suppressed, expectedForFormat.suppressed);
      }
    });
  }
}
