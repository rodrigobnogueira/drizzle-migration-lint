import { parseTableRef } from '../../identifiers';
import type { Finding, Rule, RuleContext } from '../../types';
import { docsUrlFor } from '../docs-url';

const LEADING_TRUNCATE = /^TRUNCATE\b/i;
const LEADING_TABLE = /^\s+TABLE\b/i;
const LEADING_ONLY = /^ONLY\s+/i;
const TAIL_KEYWORDS = /\b(?:RESTART\s+IDENTITY|CONTINUE\s+IDENTITY|CASCADE|RESTRICT)\b[\s\S]*$/i;

/** The caller guarantees the statement begins with the TRUNCATE keyword.
 * Parsed with anchored, non-backtracking steps rather than one greedy regex. */
function truncatedTables(statementText: string): string[] {
  const afterKeyword = statementText.replace(LEADING_TRUNCATE, '').replace(LEADING_TABLE, '');
  const targetList = afterKeyword.replace(TAIL_KEYWORDS, '').replace(/;\s*$/, '').trim();
  if (targetList.length === 0) {
    return [];
  }
  return targetList
    .split(',')
    .map((ref) => ref.trim().replace(LEADING_ONLY, ''))
    .filter((ref) => ref.length > 0)
    .map(parseTableRef);
}

export const truncateInMigration: Rule = {
  id: 'truncate-in-migration',
  severity: 'warn',
  dialects: ['postgresql', 'mysql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const statement of ctx.migration.statements) {
      if (!/^TRUNCATE\b/i.test(statement.text)) {
        continue;
      }
      const targets = truncatedTables(statement.text);
      const existing = targets.filter((table) => !ctx.newTables.has(table));
      // Truncating a table created in this same migration is a no-op on an
      // empty table — exempt. Unparseable targets stay flagged.
      if (targets.length > 0 && existing.length === 0) {
        continue;
      }
      const tables = existing.length > 0 ? existing.join(', ') : 'unknown target';
      findings.push({
        rule: this.id,
        severity: this.severity,
        message: `TRUNCATE in a migration destroys data as a side effect of schema deployment (${tables}).`,
        suggestion:
          'Move deliberate data resets to an explicit operational script, or suppress with ' +
          '`-- drizzle-migration-lint:disable-next-statement truncate-in-migration <reason>`.',
        file: ctx.migration.sqlPath,
        line: statement.line,
        migration: ctx.migration.id,
        suppressed: false,
        docsUrl: docsUrlFor(this.id),
      });
    }
    return findings;
  },
};
