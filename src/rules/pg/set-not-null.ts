import type { Finding, Rule, RuleContext } from '../../types';
import { alterTableCommands, pgFinding } from './support';

const SUGGESTION =
  'On PG 12+ use the three-step: ADD CONSTRAINT ... CHECK (col IS NOT NULL) NOT VALID → VALIDATE CONSTRAINT → ' +
  'SET NOT NULL (which then skips the table scan) → optionally drop the check.';

export const setNotNull: Rule = {
  id: 'set-not-null',
  severity: 'error',
  dialects: ['postgresql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const { line, table, cmd } of alterTableCommands(ctx)) {
      if (cmd.subtype !== 'AT_SetNotNull' || ctx.newTables.has(table)) {
        continue;
      }
      const column = cmd.name ?? 'the column';
      findings.push(
        pgFinding(
          ctx,
          this.id,
          line,
          `SET NOT NULL on "${table}"."${column}" takes ACCESS EXCLUSIVE and scans the whole table while everything waits.`,
          SUGGESTION,
          { table },
        ),
      );
    }
    return findings;
  },
};
