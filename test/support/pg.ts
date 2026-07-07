import { loadPgParser } from '../../src/pg/ast';
import { extractPgStatements } from '../../src/pg/walk';
import { splitStatements } from '../../src/splitter';
import type { Migration, MigrationSet, RuleContext, Snapshot } from '../../src/types';

interface PgContextOptions {
  newTables?: string[];
  prevSnapshot?: Snapshot | null;
}

/** Builds a RuleContext with real parsed Postgres statements, for exercising
 * pg rules directly (fast, no fixtures). */
export async function pgContext(sql: string, options: PgContextOptions = {}): Promise<RuleContext> {
  const parse = await loadPgParser();
  const pgStatements = parse ? extractPgStatements(parse, sql) : [];
  const migration: Migration = {
    id: 'm',
    index: 1,
    sqlPath: 'm.sql',
    sql,
    statements: splitStatements(sql),
    snapshot: null,
    prevSnapshot: options.prevSnapshot ?? null,
    isFirst: false,
  };
  const set: MigrationSet = {
    format: 'v1',
    dialect: 'postgresql',
    dir: '/x',
    migrations: [migration],
    diagnostics: [],
  };
  return { set, migration, newTables: new Set(options.newTables ?? []), diffOps: [], pgStatements };
}

/** A one-table snapshot carrying column types, for alter-column-type FROM
 * lookups. */
export function snapshotWithColumns(
  table: string,
  columns: Record<string, string>,
): Snapshot {
  return {
    id: 'prev',
    prevIds: [],
    renames: { tables: [], columns: [] },
    tables: new Map([
      [
        table,
        {
          identity: table,
          name: table,
          schema: null,
          columns: new Map(
            Object.entries(columns).map(([name, type]) => [name, { name, notNull: false, type }]),
          ),
          foreignKeys: new Map(),
        },
      ],
    ]),
  };
}
