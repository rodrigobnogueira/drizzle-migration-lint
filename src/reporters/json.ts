import type { LintResult } from '../types';

/** Stable machine schema — `version` bumps on breaking shape changes. */
export function renderJson(result: LintResult): string {
  return JSON.stringify(
    {
      version: 1,
      findings: result.findings,
      diagnostics: result.diagnostics,
      summary: result.summary,
    },
    null,
    2,
  );
}
