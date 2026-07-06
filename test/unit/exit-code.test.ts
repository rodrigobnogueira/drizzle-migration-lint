import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_CLEAN, EXIT_FINDINGS, computeExitCode } from '../../src/exit-code';
import type { Finding, LintResult } from '../../src/types';

function result(findings: Partial<Finding>[]): LintResult {
  return {
    findings: findings as Finding[],
    diagnostics: [],
    summary: { errors: 0, warnings: 0, suppressed: 0, migrationsChecked: 1 },
  };
}

const error = { severity: 'error', suppressed: false } as Partial<Finding>;
const warn = { severity: 'warn', suppressed: false } as Partial<Finding>;
const suppressedError = { severity: 'error', suppressed: true } as Partial<Finding>;

test('fail-on error (default): errors fail, warnings do not', () => {
  assert.equal(computeExitCode(result([error]), 'error'), EXIT_FINDINGS);
  assert.equal(computeExitCode(result([warn]), 'error'), EXIT_CLEAN);
  assert.equal(computeExitCode(result([]), 'error'), EXIT_CLEAN);
});

test('fail-on warn: any active finding fails', () => {
  assert.equal(computeExitCode(result([warn]), 'warn'), EXIT_FINDINGS);
  assert.equal(computeExitCode(result([error]), 'warn'), EXIT_FINDINGS);
  assert.equal(computeExitCode(result([]), 'warn'), EXIT_CLEAN);
});

test('fail-on none: never fails', () => {
  assert.equal(computeExitCode(result([error, warn]), 'none'), EXIT_CLEAN);
});

test('suppressed findings never affect the exit code', () => {
  assert.equal(computeExitCode(result([suppressedError]), 'error'), EXIT_CLEAN);
  assert.equal(computeExitCode(result([suppressedError]), 'warn'), EXIT_CLEAN);
});
