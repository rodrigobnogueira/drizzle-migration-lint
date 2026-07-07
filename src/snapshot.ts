import { parseTableRef, tableIdentity, unquoteIdentifier } from './identifiers';
import type {
  ColumnRenamePair,
  Dialect,
  NormalizedColumn,
  NormalizedForeignKey,
  NormalizedTable,
  RenameHints,
  RenamePair,
  Snapshot,
} from './types';

/** drizzle-kit's sentinel for "no predecessor" (both formats). */
export const ZERO_SNAPSHOT_ID = '00000000-0000-0000-0000-000000000000';

/** v1 snapshots renamed the dialect literal (`postgres`); everything else
 * matches the journal spelling. */
const V1_DIALECT_LITERALS: Record<string, Dialect> = {
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mysql: 'mysql',
  sqlite: 'sqlite',
  turso: 'turso',
  singlestore: 'singlestore',
  gel: 'gel',
  mssql: 'mssql',
  cockroach: 'cockroach',
};

export function normalizeDialect(raw: unknown): Dialect | null {
  if (typeof raw !== 'string') {
    return null;
  }
  return V1_DIALECT_LITERALS[raw] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function realPrevIds(ids: string[]): string[] {
  return ids.filter((id) => id !== ZERO_SNAPSHOT_ID);
}

const EMPTY_HINTS: RenameHints = { tables: [], columns: [] };

/** Split a rename-metadata column key into its normalized table identity and
 * column. Legacy `_meta` keys are quoted SQL identifiers (`"users"."name"`);
 * both segments are unquoted. */
function splitColumnKey(key: string): { table: string; column: string } {
  const lastDot = key.lastIndexOf('.');
  if (lastDot === -1) {
    return { table: '', column: unquoteIdentifier(key) };
  }
  return { table: parseTableRef(key.slice(0, lastDot)), column: unquoteIdentifier(key.slice(lastDot + 1)) };
}

// ---------- legacy (≤0.31.x) ----------

function legacyColumns(tableValue: Record<string, unknown>): Map<string, NormalizedColumn> {
  const columns = new Map<string, NormalizedColumn>();
  if (isRecord(tableValue.columns)) {
    for (const value of Object.values(tableValue.columns)) {
      if (isRecord(value) && typeof value.name === 'string') {
        columns.set(value.name, {
          name: value.name,
          notNull: value.notNull === true,
          type: typeof value.type === 'string' ? value.type : null,
        });
      }
    }
  }
  return columns;
}

/** Legacy FKs: a `foreignKeys` object keyed by name; `onDelete` is lowercase. */
function legacyForeignKeys(tableValue: Record<string, unknown>): Map<string, NormalizedForeignKey> {
  const foreignKeys = new Map<string, NormalizedForeignKey>();
  if (isRecord(tableValue.foreignKeys)) {
    for (const value of Object.values(tableValue.foreignKeys)) {
      if (isRecord(value) && typeof value.name === 'string' && typeof value.tableTo === 'string') {
        foreignKeys.set(value.name, {
          name: value.name,
          tableTo: tableIdentity(null, value.tableTo),
          onDelete: typeof value.onDelete === 'string' ? value.onDelete.toLowerCase() : '',
        });
      }
    }
  }
  return foreignKeys;
}

/** `_meta: { tables: {from: to}, columns: {"tbl.from": "tbl.to"} }`. */
function legacyRenameHints(raw: Record<string, unknown>): RenameHints {
  const meta = isRecord(raw._meta) ? raw._meta : {};
  const tables: RenamePair[] = [];
  if (isRecord(meta.tables)) {
    for (const [from, to] of Object.entries(meta.tables)) {
      if (typeof to === 'string') {
        tables.push({ from: parseTableRef(from), to: parseTableRef(to) });
      }
    }
  }
  const columns: ColumnRenamePair[] = [];
  if (isRecord(meta.columns)) {
    for (const [from, to] of Object.entries(meta.columns)) {
      if (typeof to === 'string') {
        const fromParts = splitColumnKey(from);
        columns.push({ table: fromParts.table, from: fromParts.column, to: splitColumnKey(to).column });
      }
    }
  }
  return { tables, columns };
}

/** Table identity comes from each VALUE's `schema`+`name` fields — never from
 * record keys, whose convention differs across kit versions (observed:
 * pg v7 keys are `public.users` with `schema: ""`; sqlite v6 keys are bare). */
export function normalizeLegacySnapshot(raw: unknown): Snapshot | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') {
    return null;
  }
  const tables = new Map<string, NormalizedTable>();
  if (isRecord(raw.tables)) {
    for (const value of Object.values(raw.tables)) {
      if (isRecord(value) && typeof value.name === 'string') {
        const schema = typeof value.schema === 'string' && value.schema !== '' ? value.schema : null;
        const identity = tableIdentity(schema, value.name);
        tables.set(identity, {
          identity,
          name: value.name,
          schema,
          columns: legacyColumns(value),
          foreignKeys: legacyForeignKeys(value),
        });
      }
    }
  }
  const prevId = typeof raw.prevId === 'string' ? [raw.prevId] : [];
  return { id: raw.id, prevIds: realPrevIds(prevId), tables, renames: legacyRenameHints(raw) };
}

// ---------- v1 (≥1.0.0) ----------

function collectV1Tables(ddl: readonly unknown[]): Map<string, NormalizedTable> {
  const tables = new Map<string, NormalizedTable>();
  for (const entity of ddl) {
    if (isRecord(entity) && entity.entityType === 'tables' && typeof entity.name === 'string') {
      const schema = typeof entity.schema === 'string' ? entity.schema : null;
      const identity = tableIdentity(schema, entity.name);
      tables.set(identity, {
        identity,
        name: entity.name,
        schema,
        columns: new Map(),
        foreignKeys: new Map(),
      });
    }
  }
  return tables;
}

/** v1 FKs: flat `entityType: 'fks'` ddl entities; `onDelete` is uppercase. The
 * `table`/`schema` fields name the FROM table; `tableTo`/`schemaTo` the target. */
function attachV1ForeignKeys(ddl: readonly unknown[], tables: Map<string, NormalizedTable>): void {
  for (const entity of ddl) {
    if (
      isRecord(entity) &&
      entity.entityType === 'fks' &&
      typeof entity.name === 'string' &&
      typeof entity.table === 'string' &&
      typeof entity.tableTo === 'string'
    ) {
      const schema = typeof entity.schema === 'string' ? entity.schema : null;
      const schemaTo = typeof entity.schemaTo === 'string' ? entity.schemaTo : null;
      const table = tables.get(tableIdentity(schema, entity.table));
      table?.foreignKeys.set(entity.name, {
        name: entity.name,
        tableTo: tableIdentity(schemaTo, entity.tableTo),
        onDelete: typeof entity.onDelete === 'string' ? entity.onDelete.toLowerCase() : '',
      });
    }
  }
}

function attachV1Columns(ddl: readonly unknown[], tables: Map<string, NormalizedTable>): void {
  for (const entity of ddl) {
    if (isRecord(entity) && entity.entityType === 'columns' && typeof entity.name === 'string' && typeof entity.table === 'string') {
      const schema = typeof entity.schema === 'string' ? entity.schema : null;
      const table = tables.get(tableIdentity(schema, entity.table));
      table?.columns.set(entity.name, {
        name: entity.name,
        notNull: entity.notNull === true,
        type: typeof entity.type === 'string' ? entity.type : null,
      });
    }
  }
}

/** v1 snapshot `ddl` is a flat entity list; tables and columns are separate
 * entities linked by the column's `table` (+ `schema`) fields. */
export function normalizeV1Snapshot(raw: unknown): Snapshot | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.ddl)) {
    return null;
  }
  const tables = collectV1Tables(raw.ddl);
  attachV1Columns(raw.ddl, tables);
  attachV1ForeignKeys(raw.ddl, tables);
  const prevIds = Array.isArray(raw.prevIds)
    ? raw.prevIds.filter((id): id is string => typeof id === 'string')
    : [];
  return { id: raw.id, prevIds: realPrevIds(prevIds), tables, renames: v1RenameHints(raw, tables) };
}

/** v1 records each rename as a string `"<fromRef>-><toRef>"` where a ref is a
 * dot path: `schema.table` / `table` for a table rename, `schema.table.column`
 * / `table.column` for a column rename (schema present only on schema-qualified
 * dialects). Table vs column is told apart dialect-agnostically: it is a column
 * rename when the ref's parent path resolves to a table in this snapshot. */
function v1RenameHints(raw: Record<string, unknown>, known: Map<string, NormalizedTable>): RenameHints {
  if (!Array.isArray(raw.renames) || raw.renames.length === 0) {
    return EMPTY_HINTS;
  }
  const tables: RenamePair[] = [];
  const columns: ColumnRenamePair[] = [];
  for (const entry of raw.renames) {
    collectV1Rename(entry, known, tables, columns);
  }
  return { tables, columns };
}

function parentIdentity(ref: string): string {
  const lastDot = ref.lastIndexOf('.');
  return lastDot === -1 ? '' : parseTableRef(ref.slice(0, lastDot));
}

function lastSegment(ref: string): string {
  return ref.slice(ref.lastIndexOf('.') + 1);
}

function collectV1Rename(
  entry: unknown,
  known: Map<string, NormalizedTable>,
  tables: RenamePair[],
  columns: ColumnRenamePair[],
): void {
  if (typeof entry !== 'string') {
    return;
  }
  const arrow = entry.indexOf('->');
  if (arrow === -1) {
    return;
  }
  const fromRef = entry.slice(0, arrow);
  const toRef = entry.slice(arrow + 2);
  const fromTable = parentIdentity(fromRef);
  if (known.has(fromTable)) {
    columns.push({ table: fromTable, from: lastSegment(fromRef), to: lastSegment(toRef) });
  } else {
    tables.push({ from: parseTableRef(fromRef), to: parseTableRef(toRef) });
  }
}

export function v1SnapshotDialect(raw: unknown): Dialect | null {
  return isRecord(raw) ? normalizeDialect(raw.dialect) : null;
}
