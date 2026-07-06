import { constraintsOf } from '../../pg/nodes';
import type { Finding, Rule, RuleContext } from '../../types';
import { alterTableCommands, pgFinding } from './support';

const SUGGESTION =
  'Add the column nullable, backfill in batches, then enforce NOT NULL via the set-not-null recipe. ' +
  'Or, if a constant default is acceptable, ADD COLUMN ... NOT NULL DEFAULT <constant> is rewrite-free on PG 11+.';

export const addColumnNotNullNoDefault: Rule = {
  id: 'add-column-not-null-no-default',
  severity: 'error',
  dialects: ['postgresql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const { line, table, cmd } of alterTableCommands(ctx)) {
      if (cmd.subtype !== 'AT_AddColumn' || ctx.newTables.has(table)) {
        continue;
      }
      const constraints = constraintsOf(cmd.def?.ColumnDef);
      const hasNotNull = constraints.some((c) => c.contype === 'CONSTR_NOTNULL');
      const hasDefault = constraints.some((c) => c.contype === 'CONSTR_DEFAULT');
      if (hasNotNull && !hasDefault) {
        const column = cmd.def?.ColumnDef?.colname ?? 'the new column';
        findings.push(
          pgFinding(
            ctx,
            this.id,
            line,
            `Adding NOT NULL column "${column}" to "${table}" without a default fails on any non-empty table.`,
            SUGGESTION,
          ),
        );
      }
    }
    return findings;
  },
};
