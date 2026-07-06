import type { Finding, LintResult } from '../types';

const TOOL_URI = 'https://github.com/rodrigobnogueira/drizzle-migration-lint';

/** SARIF `error`/`warning`; drizzle-migration-lint has no `note` severity. */
function sarifLevel(finding: Finding): 'error' | 'warning' {
  return finding.severity === 'error' ? 'error' : 'warning';
}

function sarifResult(finding: Finding): Record<string, unknown> {
  const result: Record<string, unknown> = {
    ruleId: finding.rule,
    level: sarifLevel(finding),
    message: { text: `${finding.message} ${finding.suggestion}` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: finding.file },
          region: { startLine: finding.line },
        },
      },
    ],
  };
  // suppressed findings stay in the report, marked so code-scanning hides them
  if (finding.suppressed) {
    result.suppressions = [{ kind: 'inSource' }];
  }
  return result;
}

/** SARIF 2.1.0 — for `github/codeql-action/upload-sarif` / code scanning. Only
 * the rules that appear in findings are described (a valid SARIF subset). */
export function renderSarif(result: LintResult): string {
  const rulesById = new Map<string, { id: string; helpUri: string }>();
  for (const finding of result.findings) {
    if (!rulesById.has(finding.rule)) {
      rulesById.set(finding.rule, { id: finding.rule, helpUri: finding.docsUrl });
    }
  }
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'drizzle-migration-lint',
            informationUri: TOOL_URI,
            rules: [...rulesById.values()],
          },
        },
        results: result.findings.map(sarifResult),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}
