import { parseTableRef } from '../../identifiers';
import type { Finding, Rule, RuleContext, SqlStatement, Snapshot } from '../../types';
import { docsUrlFor } from '../docs-url';

// SQLite can't ALTER many things in place, so drizzle-kit rebuilds the table:
// CREATE "__new_X" → copy → DROP TABLE "X" → ALTER TABLE "__new_X" RENAME TO "X".
const NEW_RENAME = /^ALTER\s+TABLE\s+[`"]?__new_[^\s`"]+[`"]?\s+RENAME\s+TO\s+([^\s;]+)/i;
const DROP_TABLE = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/i;
const GUARD = /PRAGMA\s+foreign_keys\s*=\s*OFF/i;

// onDelete actions that mutate child rows when the parent's rows are deleted.
const DATA_LOSING = new Set(['cascade', 'set null', 'set default']);

interface Recreate {
  table: string;
  line: number;
}

/** Tables rebuilt by the `__new_` dance, anchored to their `DROP TABLE` line. */
function recreatedTables(statements: readonly SqlStatement[]): Recreate[] {
  const dropLines = new Map<string, number>();
  const renamed = new Map<string, number>();
  for (const statement of statements) {
    const rename = NEW_RENAME.exec(statement.text);
    if (rename) {
      renamed.set(parseTableRef(rename[1] as string), statement.line);
      continue;
    }
    const drop = DROP_TABLE.exec(statement.text);
    if (drop) {
      dropLines.set(parseTableRef(drop[1] as string), statement.line);
    }
  }
  return [...renamed].map(([table, renameLine]) => ({ table, line: dropLines.get(table) ?? renameLine }));
}

/** Pre-existing tables with an FK → `recreated` whose onDelete mutates child rows. */
function cascadingChildren(snapshot: Snapshot, recreated: string, newTables: Set<string>): string[] {
  const children: string[] = [];
  for (const table of snapshot.tables.values()) {
    if (newTables.has(table.identity)) {
      continue; // a table created in this migration has no rows to lose
    }
    for (const fk of table.foreignKeys.values()) {
      if (fk.tableTo === recreated && DATA_LOSING.has(fk.onDelete)) {
        children.push(table.identity);
        break;
      }
    }
  }
  return children;
}

function describe(recreated: string, children: string[], guarded: boolean): Pick<Finding, 'message' | 'suggestion'> {
  const list = children.map((child) => `"${child}"`).join(', ');
  const base =
    `Recreating "${recreated}" drops it, and SQLite's implicit DELETE fires the ON DELETE ` +
    `action (cascade/set null/set default) on ${list}, silently changing those rows.`;
  if (guarded) {
    return {
      message:
        `${base} drizzle-kit disables foreign keys for the rebuild, which protects standard SQLite — ` +
        'but Cloudflare D1 ignores PRAGMA foreign_keys and loses that data anyway (drizzle-team/drizzle-orm#4938).',
      suggestion:
        `On Cloudflare D1, back up ${list} before applying — the PRAGMA foreign_keys=OFF guard does not ` +
        'work there (#4938). On standard SQLite/libsql the guard protects the data.',
    };
  }
  return {
    message: `${base} This migration does not disable foreign keys, so ${list} loses data on all SQLite.`,
    suggestion:
      'Wrap the recreate in PRAGMA foreign_keys=OFF; ... PRAGMA foreign_keys=ON; (drizzle-kit does this ' +
      `automatically). Note Cloudflare D1 ignores the pragma — back up ${list} there (#4938).`,
  };
}

export const recreateCascadeDataLoss: Rule = {
  id: 'recreate-cascade-data-loss',
  severity: 'warn',
  dialects: ['sqlite'],
  check(ctx: RuleContext): Finding[] {
    const snapshot = ctx.migration.snapshot ?? ctx.migration.prevSnapshot;
    if (!snapshot) {
      return [];
    }
    const guarded = GUARD.test(ctx.migration.sql);
    const findings: Finding[] = [];
    for (const recreate of recreatedTables(ctx.migration.statements)) {
      const children = cascadingChildren(snapshot, recreate.table, ctx.newTables);
      if (children.length === 0) {
        continue;
      }
      findings.push({
        rule: this.id,
        severity: this.severity,
        ...describe(recreate.table, children, guarded),
        file: ctx.migration.sqlPath,
        line: recreate.line,
        migration: ctx.migration.id,
        suppressed: false,
        table: recreate.table,
        docsUrl: docsUrlFor(this.id),
      });
    }
    return findings;
  },
};
