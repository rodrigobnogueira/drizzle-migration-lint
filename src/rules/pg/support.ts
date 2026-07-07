import { tableIdentity } from '../../identifiers';
import type { AlterTableCmd, AlterTableStmt, Constraint, RangeVar } from '../../pg/nodes';
import type { Finding, RuleContext, RuleId, Severity } from '../../types';
import { docsUrlFor } from '../docs-url';

export function pgTableIdentity(relation: RangeVar | undefined): string {
  return tableIdentity(relation?.schemaname ?? null, relation?.relname ?? '');
}

/** Builds a finding on the current statement's line. Defaults to `error` (the
 * lock/rewrite rules); pass `severity: 'warn'` for advisory rules. `table` is
 * the affected table's identity, so size-exemption can match it to a live size. */
export function pgFinding(
  ctx: RuleContext,
  id: RuleId,
  line: number,
  message: string,
  suggestion: string,
  opts: { severity?: Severity; table?: string } = {},
): Finding {
  return {
    rule: id,
    severity: opts.severity ?? 'error',
    message,
    suggestion,
    file: ctx.migration.sqlPath,
    line,
    migration: ctx.migration.id,
    suppressed: false,
    table: opts.table,
    docsUrl: docsUrlFor(id),
  };
}

export interface AlterCmdContext {
  line: number;
  /** normalized identity of the altered table */
  table: string;
  cmd: AlterTableCmd;
}

/** Flattens every `ALTER TABLE` command across the migration's statements,
 * carrying the table identity and source line. The new-table exemption is a
 * caller concern — check `ctx.newTables.has(table)`. */
export function* alterTableCommands(ctx: RuleContext): Generator<AlterCmdContext> {
  for (const statement of ctx.pgStatements) {
    if (statement.kind !== 'AlterTableStmt') {
      continue;
    }
    const alter = statement.node as unknown as AlterTableStmt;
    const table = pgTableIdentity(alter.relation);
    for (const wrap of alter.cmds ?? []) {
      if (wrap.AlterTableCmd) {
        yield { line: statement.line, table, cmd: wrap.AlterTableCmd };
      }
    }
  }
}

export interface ConstraintContext {
  line: number;
  table: string;
  constraint: Constraint;
}

/** Only `ADD CONSTRAINT` commands (subtype AT_AddConstraint). AT_ValidateConstraint
 * is deliberately excluded, so the safe second step of a NOT VALID sequence
 * never flags. */
export function* addConstraintCommands(ctx: RuleContext): Generator<ConstraintContext> {
  for (const { line, table, cmd } of alterTableCommands(ctx)) {
    if (cmd.subtype === 'AT_AddConstraint' && cmd.def?.Constraint) {
      yield { line, table, constraint: cmd.def.Constraint };
    }
  }
}
