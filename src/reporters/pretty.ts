import * as util from 'node:util';
import type { Diagnostic, Finding, LintResult, LintSummary } from '../types';

type Color = 'red' | 'yellow' | 'cyan' | 'dim' | 'bold';
type Styler = (color: Color, text: string) => string;

/** `util.styleText` is feature-detected (Node 20.12+) and NO_COLOR wins. */
export function makeStyler(
  env: NodeJS.ProcessEnv = process.env,
  supportsStyle: boolean = typeof util.styleText === 'function',
): Styler {
  if (!supportsStyle || env.NO_COLOR) {
    return (_color, text) => text;
  }
  return (color, text) => util.styleText(color, text);
}

function renderFinding(finding: Finding, style: Styler): string {
  const severity =
    finding.severity === 'error' ? style('red', 'error') : style('yellow', 'warn');
  const suppressed = finding.suppressed ? style('dim', ' (suppressed)') : '';
  const arrow = style('dim', `→ ${finding.suggestion}`);
  return [
    `  ${style('dim', String(finding.line))}  ${severity}  ${style('cyan', finding.rule)}${suppressed}`,
    `      ${finding.message}`,
    `      ${arrow}`,
    `      ${style('dim', finding.docsUrl)}`,
  ].join('\n');
}

function groupByFile(findings: readonly Finding[]): Map<string, Finding[]> {
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const bucket = byFile.get(finding.file) ?? [];
    bucket.push(finding);
    byFile.set(finding.file, bucket);
  }
  return byFile;
}

function renderDiagnostic(diagnostic: Diagnostic, style: Styler): string {
  const scope = diagnostic.migration ? ` [${diagnostic.migration}]` : '';
  return style('yellow', `diagnostic ${diagnostic.code}${scope}: ${diagnostic.message}`);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function renderSummary(summary: LintSummary, style: Styler): string {
  const { errors, warnings, suppressed, migrationsChecked } = summary;
  const tail = style('dim', `(${plural(migrationsChecked, 'migration')} checked)`);
  if (errors + warnings === 0) {
    // Suppressed findings stay visible even on an otherwise-clean run.
    const supp = suppressed > 0 ? ` ${suppressed} suppressed` : '';
    return `${style('bold', 'No unsafe operations found.')}${supp} ${tail}`;
  }
  const counts = [plural(errors, 'error'), plural(warnings, 'warning')];
  if (suppressed > 0) {
    counts.push(`${suppressed} suppressed`);
  }
  return `${counts.join(', ')} ${tail}`;
}

export function renderPretty(result: LintResult, env: NodeJS.ProcessEnv = process.env): string {
  const style = makeStyler(env);
  const lines: string[] = [];

  for (const [file, findings] of groupByFile(result.findings)) {
    lines.push(style('bold', file));
    for (const finding of findings) {
      lines.push(renderFinding(finding, style));
    }
    lines.push('');
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(renderDiagnostic(diagnostic, style));
  }
  if (result.diagnostics.length > 0) {
    lines.push('');
  }

  lines.push(renderSummary(result.summary, style));
  return lines.join('\n');
}
