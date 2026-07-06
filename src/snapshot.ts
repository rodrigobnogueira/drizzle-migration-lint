import { tableIdentity } from './identifiers';
import type { Dialect, Snapshot } from './types';

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

/** Legacy (≤0.31.x) snapshot: `{ id, prevId, tables: Record<key, table> }`.
 * Table identity comes from each VALUE's `schema`+`name` fields — never from
 * record keys, whose convention differs across kit versions (observed:
 * pg v7 keys are `public.users` with `schema: ""`; sqlite v6 keys are bare). */
export function normalizeLegacySnapshot(raw: unknown): Snapshot | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') {
    return null;
  }
  const tables = new Set<string>();
  if (isRecord(raw.tables)) {
    for (const value of Object.values(raw.tables)) {
      if (isRecord(value) && typeof value.name === 'string') {
        const schema = typeof value.schema === 'string' && value.schema !== '' ? value.schema : null;
        tables.add(tableIdentity(schema, value.name));
      }
    }
  }
  const prevId = typeof raw.prevId === 'string' ? [raw.prevId] : [];
  return { id: raw.id, prevIds: realPrevIds(prevId), tables };
}

/** v1 (≥1.0.0) snapshot: `{ id, prevIds: [...], ddl: [entity, ...] }` where
 * entities carry an `entityType` discriminator; tables are
 * `{ entityType: 'tables', name, schema? }` (no schema field on sqlite). */
export function normalizeV1Snapshot(raw: unknown): Snapshot | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.ddl)) {
    return null;
  }
  const tables = new Set<string>();
  for (const entity of raw.ddl) {
    if (isRecord(entity) && entity.entityType === 'tables' && typeof entity.name === 'string') {
      const schema = typeof entity.schema === 'string' ? entity.schema : null;
      tables.add(tableIdentity(schema, entity.name));
    }
  }
  const prevIds = Array.isArray(raw.prevIds)
    ? raw.prevIds.filter((id): id is string => typeof id === 'string')
    : [];
  return { id: raw.id, prevIds: realPrevIds(prevIds), tables };
}

export function v1SnapshotDialect(raw: unknown): Dialect | null {
  return isRecord(raw) ? normalizeDialect(raw.dialect) : null;
}
