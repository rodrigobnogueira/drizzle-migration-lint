import { parseTableRef, unquoteIdentifier } from './identifiers';
import { matchRename } from './sql-renames';
import type {
  ColumnRenamePair,
  DiffOp,
  DiffOpBody,
  Migration,
  NormalizedTable,
  RenameHints,
  RenamePair,
  Snapshot,
  SqlStatement,
} from './types';

const DROP_TABLE = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/i;
const DROP_COLUMN = /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([^\s;,]+)/gi;
const ALTER_TARGET = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/i;

/** sqlite's table-recreate dance renames a `__new_*` temp table into place;
 * those are never real user-facing renames (snapshots never contain them). */
function isTempTable(identity: string): boolean {
  return /^__new_/i.test(identity);
}

interface RenameSet {
  tables: RenamePair[];
  columns: ColumnRenamePair[];
  /** old table identity → new identity, for locating a survived table's prior self. */
  tableFromByTo: Map<string, string>;
}

function combineRenames(statements: readonly SqlStatement[], hints: RenameHints): RenameSet {
  const tableSeen = new Set<string>();
  const tables: RenamePair[] = [];
  for (const pair of collectTablePairs(statements, hints.tables)) {
    const key = `${pair.from}\u0000${pair.to}`;
    if (!isTempTable(pair.from) && !tableSeen.has(key)) {
      tableSeen.add(key);
      tables.push(pair);
    }
  }
  const columnSeen = new Set<string>();
  const columns: ColumnRenamePair[] = [];
  for (const pair of collectColumnPairs(statements, hints.columns)) {
    const key = `${pair.table}\u0000${pair.from}\u0000${pair.to}`;
    if (!isTempTable(pair.table) && !columnSeen.has(key)) {
      columnSeen.add(key);
      columns.push(pair);
    }
  }
  return { tables, columns, tableFromByTo: new Map(tables.map((r) => [r.to, r.from])) };
}

function collectTablePairs(statements: readonly SqlStatement[], hints: RenamePair[]): RenamePair[] {
  const fromSql: RenamePair[] = [];
  for (const statement of statements) {
    const rename = matchRename(statement);
    if (rename && !('table' in rename)) {
      fromSql.push({ from: rename.from, to: rename.to });
    }
  }
  return [...fromSql, ...hints];
}

function collectColumnPairs(
  statements: readonly SqlStatement[],
  hints: ColumnRenamePair[],
): ColumnRenamePair[] {
  const fromSql: ColumnRenamePair[] = [];
  for (const statement of statements) {
    const rename = matchRename(statement);
    if (rename && 'table' in rename) {
      fromSql.push({ table: rename.table, from: rename.from, to: rename.to });
    }
  }
  return [...fromSql, ...hints];
}

// ---------- line location (best-effort; falls back to line 1) ----------

function dropColumnMatches(text: string, column: string): boolean {
  DROP_COLUMN.lastIndex = 0;
  for (let m = DROP_COLUMN.exec(text); m !== null; m = DROP_COLUMN.exec(text)) {
    if (unquoteIdentifier(m[1] as string) === column) {
      return true;
    }
  }
  return false;
}

function statementMatchesOp(statement: SqlStatement, op: DiffOpBody): boolean {
  const { text } = statement;
  if (op.kind === 'drop-table') {
    const match = DROP_TABLE.exec(text);
    return match !== null && parseTableRef(match[1] as string) === op.table;
  }
  if (op.kind === 'drop-column') {
    const target = ALTER_TARGET.exec(text);
    return target !== null && parseTableRef(target[1] as string) === op.table && dropColumnMatches(text, op.column);
  }
  const rename = matchRename(statement);
  if (!rename) {
    return false;
  }
  if (op.kind === 'rename-table') {
    return !('table' in rename) && rename.from === op.from && rename.to === op.to;
  }
  return 'table' in rename && rename.from === op.from && rename.to === op.to;
}

function locateLine(statements: readonly SqlStatement[], op: DiffOpBody): number {
  for (const statement of statements) {
    if (statementMatchesOp(statement, op)) {
      return statement.line;
    }
  }
  return 1;
}

function withLine(statements: readonly SqlStatement[], op: DiffOpBody): DiffOp {
  return { ...op, line: locateLine(statements, op) };
}

// ---------- structural diff ----------

function diffTables(prev: Snapshot, next: Snapshot, renames: RenameSet, statements: readonly SqlStatement[]): DiffOp[] {
  const ops: DiffOp[] = [];
  for (const { from, to } of renames.tables) {
    if (prev.tables.has(from) && next.tables.has(to) && !prev.tables.has(to)) {
      ops.push(withLine(statements, { kind: 'rename-table', from, to }));
    }
  }
  const renamedAway = new Set(renames.tables.map((r) => r.from));
  for (const identity of prev.tables.keys()) {
    if (!next.tables.has(identity) && !renamedAway.has(identity)) {
      ops.push(withLine(statements, { kind: 'drop-table', table: identity }));
    }
  }
  return ops;
}

function diffColumnsOfTable(
  identity: string,
  prevTable: NormalizedTable,
  nextTable: NormalizedTable,
  renames: RenameSet,
  statements: readonly SqlStatement[],
): DiffOp[] {
  const ops: DiffOp[] = [];
  const pairs = renames.columns.filter((r) => r.table === identity || r.table === prevTable.identity);
  for (const { from, to } of pairs) {
    if (prevTable.columns.has(from) && nextTable.columns.has(to) && !prevTable.columns.has(to)) {
      ops.push(withLine(statements, { kind: 'rename-column', table: identity, from, to }));
    }
  }
  const renamedAway = new Set(pairs.map((r) => r.from));
  for (const column of prevTable.columns.keys()) {
    if (!nextTable.columns.has(column) && !renamedAway.has(column)) {
      ops.push(withLine(statements, { kind: 'drop-column', table: identity, column }));
    }
  }
  return ops;
}

function diffColumns(prev: Snapshot, next: Snapshot, renames: RenameSet, statements: readonly SqlStatement[]): DiffOp[] {
  const ops: DiffOp[] = [];
  for (const [identity, nextTable] of next.tables) {
    const prevIdentity = renames.tableFromByTo.get(identity) ?? identity;
    const prevTable = prev.tables.get(prevIdentity);
    if (prevTable) {
      ops.push(...diffColumnsOfTable(identity, prevTable, nextTable, renames, statements));
    }
  }
  return ops;
}

/** Semantic diff of one migration: prev → next snapshot, renames resolved.
 * Returns nothing without both snapshots (first migration, or a gap the reader
 * refused to bridge) — there is no safe structural diff in that case. */
export function diffMigration(migration: Migration): DiffOp[] {
  const { snapshot, prevSnapshot } = migration;
  if (!snapshot || !prevSnapshot) {
    return [];
  }
  const renames = combineRenames(migration.statements, snapshot.renames);
  return [
    ...diffTables(prevSnapshot, snapshot, renames, migration.statements),
    ...diffColumns(prevSnapshot, snapshot, renames, migration.statements),
  ];
}
