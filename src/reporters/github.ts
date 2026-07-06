import { appendFileSync } from 'node:fs';
import type { Finding, LintResult } from '../types';

/** Escaping for GitHub workflow-command data and property values. */
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function annotation(finding: Finding): string {
  const level = finding.severity === 'error' ? 'error' : 'warning';
  const title = escapeProperty(`drizzle-migration-lint(${finding.rule})`);
  const body = escapeData(`${finding.message} — ${finding.suggestion}`);
  return `::${level} file=${escapeProperty(finding.file)},line=${finding.line},title=${title}::${body}`;
}

export function renderGithubAnnotations(result: LintResult): string {
  return result.findings
    .filter((finding) => !finding.suppressed)
    .map(annotation)
    .join('\n');
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderGithubSummary(result: LintResult): string {
  const { errors, warnings, suppressed, migrationsChecked } = result.summary;
  const lines = [
    '### drizzle-migration-lint',
    '',
    `${errors} error(s), ${warnings} warning(s), ${suppressed} suppressed across ${migrationsChecked} migration(s).`,
    '',
  ];
  const active = result.findings.filter((finding) => !finding.suppressed);
  if (active.length > 0) {
    lines.push('| Severity | Rule | File | Line | Message |', '| :--- | :--- | :--- | ---: | :--- |');
    for (const finding of active) {
      lines.push(`| ${finding.severity} | ${finding.rule} | ${cell(finding.file)} | ${finding.line} | ${cell(finding.message)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Prints one workflow-command annotation per finding to stdout (the return
 * value) and, when running in Actions, appends a markdown table to
 * $GITHUB_STEP_SUMMARY. The append is injectable for testing. */
export function renderGithub(
  result: LintResult,
  env: NodeJS.ProcessEnv = process.env,
  append: (path: string, data: string) => void = appendFileSync,
): string {
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    append(summaryPath, `${renderGithubSummary(result)}\n`);
  }
  return renderGithubAnnotations(result);
}
