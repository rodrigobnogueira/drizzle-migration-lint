import type { Finding, Rule, RuleContext } from '../../types';
import { addConstraintCommands, pgFinding } from './support';

const SUGGESTION =
  'CREATE UNIQUE INDEX CONCURRENTLY in its own out-of-transaction migration, then ' +
  'ADD CONSTRAINT ... PRIMARY KEY USING INDEX <idx> — which attaches instantly.';

export const addPrimaryKeyOnExistingTable: Rule = {
  id: 'add-primary-key-on-existing-table',
  severity: 'error',
  dialects: ['postgresql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const { line, table, constraint } of addConstraintCommands(ctx)) {
      if (constraint.contype !== 'CONSTR_PRIMARY' || ctx.newTables.has(table)) {
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
          `Adding a PRIMARY KEY to "${table}" builds its unique index under ACCESS EXCLUSIVE for the whole build.`,
          SUGGESTION,
          { table },
        ),
      );
    }
    return findings;
  },
};
