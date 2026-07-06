import { constraintsOf } from '../../pg/nodes';
import { classifyDefault, type DefaultVolatility } from '../../pg/volatility';
import type { Finding, Rule, RuleContext } from '../../types';
import { alterTableCommands, pgFinding } from './support';

const SUGGESTION =
  'Add the column with no default (or a constant), set the default afterwards so it applies to new rows only, ' +
  'then backfill existing rows in batches.';

function message(
  table: string,
  column: string,
  verdict: Exclude<DefaultVolatility, { kind: 'safe' }>,
): string {
  if (verdict.kind === 'volatile') {
    return `Adding column "${column}" to "${table}" with a volatile default (${verdict.fn}()) rewrites every existing row under ACCESS EXCLUSIVE.`;
  }
  return `Adding column "${column}" to "${table}" with default ${verdict.fn}(): cannot verify the function is non-volatile — a volatile default rewrites the whole table.`;
}

export const volatileDefaultOnAddColumn: Rule = {
  id: 'volatile-default-on-add-column',
  severity: 'error',
  dialects: ['postgresql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const { line, table, cmd } of alterTableCommands(ctx)) {
      if (cmd.subtype !== 'AT_AddColumn' || ctx.newTables.has(table)) {
        continue;
      }
      const defaultConstraint = constraintsOf(cmd.def?.ColumnDef).find(
        (constraint) => constraint.contype === 'CONSTR_DEFAULT',
      );
      const verdict = classifyDefault(defaultConstraint?.raw_expr);
      if (verdict.kind === 'safe') {
        continue;
      }
      const column = cmd.def?.ColumnDef?.colname ?? 'the new column';
      findings.push(pgFinding(ctx, this.id, line, message(table, column, verdict), SUGGESTION));
    }
    return findings;
  },
};
