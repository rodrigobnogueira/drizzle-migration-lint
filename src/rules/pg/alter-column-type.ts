import type { ColumnDef, PgExpr } from '../../pg/nodes';
import type { Finding, Rule, RuleContext } from '../../types';
import { isSafeWidening, parseAstType, parseSnapshotType } from '../type-widening';
import { alterTableCommands, pgFinding } from './support';

const SUGGESTION =
  'Add a new column of the target type, dual-write, backfill in batches, switch reads, then drop the old column.';

function prevColumnType(ctx: RuleContext, table: string, column: string): string | null {
  return ctx.migration.prevSnapshot?.tables.get(table)?.columns.get(column)?.type ?? null;
}

/** drizzle mechanically emits `USING "col"::targettype` for EVERY type change,
 * so a plain column-cast USING is not a danger signal — only a non-trivial
 * expression is. Trivial ⇔ TypeCast wrapping a ColumnRef to this same column. */
function isTrivialCast(expr: PgExpr | undefined, column: string): boolean {
  const cast = expr?.TypeCast as { arg?: PgExpr } | undefined;
  const fields = (cast?.arg?.ColumnRef as { fields?: { String?: { sval?: string } }[] } | undefined)?.fields;
  return fields?.length === 1 && fields[0]?.String?.sval === column;
}

/** Safe only when any USING is drizzle's trivial cast AND the from-type is
 * known AND the from→to pair is on the widening whitelist. */
function isSafeRetype(fromRaw: string | null, columnDef: ColumnDef | undefined, column: string): boolean {
  const using = columnDef?.raw_default;
  if (using !== undefined && !isTrivialCast(using, column)) {
    return false; // a real USING expression forces whole-table evaluation
  }
  const toType = parseAstType(columnDef?.typeName);
  if (!toType || fromRaw === null) {
    return false;
  }
  return isSafeWidening(parseSnapshotType(fromRaw), toType);
}

export const alterColumnType: Rule = {
  id: 'alter-column-type',
  severity: 'error',
  dialects: ['postgresql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const { line, table, cmd } of alterTableCommands(ctx)) {
      if (cmd.subtype !== 'AT_AlterColumnType' || ctx.newTables.has(table)) {
        continue;
      }
      const column = cmd.name ?? '';
      const columnDef = cmd.def?.ColumnDef;
      if (isSafeRetype(prevColumnType(ctx, table, column), columnDef, column)) {
        continue;
      }
      const using = columnDef?.raw_default;
      const note = using !== undefined && !isTrivialCast(using, column) ? ' The USING clause forces a full-table rewrite.' : '';
      findings.push(
        pgFinding(
          ctx,
          this.id,
          line,
          `Changing the type of "${table}"."${column}" rewrites the whole table under ACCESS EXCLUSIVE.${note}`,
          SUGGESTION,
          { table },
        ),
      );
    }
    return findings;
  },
};
