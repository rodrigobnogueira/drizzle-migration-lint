import type { LintResult } from './types';

export type FailOn = 'error' | 'warn' | 'none';

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;

/** 0 = clean or everything below the fail level; 1 = unsuppressed findings
 * at/above the level; 2 (usage/environment errors) is decided by the CLI,
 * never here. */
export function computeExitCode(result: LintResult, failOn: FailOn): number {
  if (failOn === 'none') {
    return EXIT_CLEAN;
  }
  const active = result.findings.filter((finding) => !finding.suppressed);
  const hasErrors = active.some((finding) => finding.severity === 'error');
  const hasWarnings = active.some((finding) => finding.severity === 'warn');
  if (failOn === 'warn') {
    return hasErrors || hasWarnings ? EXIT_FINDINGS : EXIT_CLEAN;
  }
  return hasErrors ? EXIT_FINDINGS : EXIT_CLEAN;
}
