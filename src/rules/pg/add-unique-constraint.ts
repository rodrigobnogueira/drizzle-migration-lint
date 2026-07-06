import type { Finding, Rule, RuleContext } from '../../types';
import { addConstraintCommands, pgFinding } from './support';

const SUGGESTION =
  'CREATE UNIQUE INDEX CONCURRENTLY in its own out-of-transaction migration, then ' +
  'ADD CONSTRAINT ... UNIQUE USING INDEX <idx> — which attaches instantly.';

export const addUniqueConstraint: Rule = {
  id: 'add-unique-constraint',
  severity: 'error',
  dialects: ['postgresql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const { line, table, constraint } of addConstraintCommands(ctx)) {
      if (constraint.contype !== 'CONSTR_UNIQUE' || ctx.newTables.has(table)) {
        continue;
      }
      if (constraint.indexname !== undefined) {
        continue; // USING INDEX <name> — attaches instantly, safe
      }
      findings.push(
        pgFinding(
          ctx,
          this.id,
          line,
          `Adding a UNIQUE constraint to "${table}" builds its unique index under ACCESS EXCLUSIVE for the whole build.`,
          SUGGESTION,
        ),
      );
    }
    return findings;
  },
};
