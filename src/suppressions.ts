import { RULE_IDS } from './rules';
import type { Finding, SqlStatement } from './types';

/** In-SQL suppression directives:
 *
 *   -- drizzle-migration-lint:disable-next-statement <rule-id>[,<id>...] [reason]
 *   -- drizzle-migration-lint:disable-file          <rule-id>[,<id>...] [reason]
 *
 * With no rule ids, every rule is suppressed for the scope. Suppressed
 * findings are marked, not removed — they stay visible in summary counts. */
const DIRECTIVE = /--\s*drizzle-migration-lint:(disable-next-statement|disable-file)\b[ \t]*([^\n]*)/i;

interface Directive {
  kind: 'disable-next-statement' | 'disable-file';
  /** null = all rules. */
  rules: Set<string> | null;
  line: number;
}

function parseRuleList(rest: string): Set<string> | null {
  const trimmed = rest.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // the leading token is a rule-id list only when every comma-part is a known
  // rule id; otherwise it is prose (a reason) and the directive means "all
  // rules". This is how `disable-file drop-table` is told apart from
  // `disable-file because it is intentional`.
  const first = trimmed.split(/\s+/)[0] as string;
  const ids = first.split(',');
  return ids.every((id) => RULE_IDS.has(id)) ? new Set(ids) : null;
}

export function parseDirectives(sql: string): Directive[] {
  const directives: Directive[] = [];
  const lines = sql.split('\n');
  for (const [index, text] of lines.entries()) {
    const match = DIRECTIVE.exec(text);
    if (match) {
      directives.push({
        kind: match[1] as Directive['kind'],
        rules: parseRuleList(match[2] as string),
        line: index + 1,
      });
    }
  }
  return directives;
}

function suppresses(rules: Set<string> | null, rule: string): boolean {
  return rules === null || rules.has(rule);
}

/** Start line of the statement that follows `afterLine`, or Infinity if none. */
function nextStatementLine(statements: readonly SqlStatement[], afterLine: number): number {
  let best = Infinity;
  for (const statement of statements) {
    if (statement.line > afterLine && statement.line < best) {
      best = statement.line;
    }
  }
  return best;
}

/** Marks findings suppressed in place per the directives found in the SQL. */
export function applySuppressions(
  findings: Finding[],
  sql: string,
  statements: readonly SqlStatement[],
): void {
  const directives = parseDirectives(sql);
  for (const directive of directives) {
    if (directive.kind === 'disable-file') {
      suppressFile(findings, directive.rules);
    } else {
      suppressNextStatement(findings, directive, statements);
    }
  }
}

function suppressFile(findings: Finding[], rules: Set<string> | null): void {
  for (const finding of findings) {
    if (suppresses(rules, finding.rule)) {
      finding.suppressed = true;
    }
  }
}

function suppressNextStatement(
  findings: Finding[],
  directive: Directive,
  statements: readonly SqlStatement[],
): void {
  const start = nextStatementLine(statements, directive.line);
  if (start === Infinity) {
    return;
  }
  const end = nextStatementLine(statements, start);
  for (const finding of findings) {
    if (finding.line >= start && finding.line < end && suppresses(directive.rules, finding.rule)) {
      finding.suppressed = true;
    }
  }
}
