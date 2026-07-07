import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { NormalizedForeignKey, NormalizedTable, RenameHints, Snapshot } from '../../src/types';

/** Creates a throwaway directory populated from a `path → content` map and
 * returns it with a cleanup function. */
export function tempTree(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'dml-test-'));
  for (const [path, content] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function legacySnapshotJson(
  id: string,
  prevId: string,
  tables: Record<string, { name: string; schema?: string }>,
): string {
  return JSON.stringify({ id, prevId, version: '7', dialect: 'postgresql', tables });
}

export function v1SnapshotJson(
  id: string,
  prevIds: string[],
  tableNames: string[],
  dialect = 'postgres',
): string {
  return JSON.stringify({
    version: '8',
    dialect,
    id,
    prevIds,
    ddl: tableNames.map((name) => ({ entityType: 'tables', name, schema: 'public' })),
    renames: [],
  });
}

export function journalJson(dialect: string, tags: string[]): string {
  return JSON.stringify({
    version: '7',
    dialect,
    entries: tags.map((tag, idx) => ({ idx, version: '7', when: 1700000000000 + idx, tag, breakpoints: true })),
  });
}

export const ZERO = '00000000-0000-0000-0000-000000000000';

function splitIdentity(identity: string): { schema: string | null; name: string } {
  const dot = identity.lastIndexOf('.');
  return dot === -1
    ? { schema: null, name: identity }
    : { schema: identity.slice(0, dot), name: identity.slice(dot + 1) };
}

/** Builds a normalized Snapshot object directly (not raw JSON): `tables` maps
 * a table identity to its column names. Columns default to nullable — the
 * structural rules only care about presence. */
export function makeSnapshot(
  id: string,
  tables: Record<string, string[]>,
  opts: {
    prevIds?: string[];
    renames?: RenameHints;
    /** per-table foreign keys, keyed by the owning table's identity */
    foreignKeys?: Record<string, { tableTo: string; onDelete: string; name?: string }[]>;
  } = {},
): Snapshot {
  const map = new Map<string, NormalizedTable>();
  for (const [identity, cols] of Object.entries(tables)) {
    const { schema, name } = splitIdentity(identity);
    const fks = new Map<string, NormalizedForeignKey>();
    (opts.foreignKeys?.[identity] ?? []).forEach((fk, index) => {
      const fkName = fk.name ?? `${name}_fk_${index}`;
      fks.set(fkName, { name: fkName, tableTo: fk.tableTo, onDelete: fk.onDelete });
    });
    map.set(identity, {
      identity,
      name,
      schema,
      columns: new Map(cols.map((col) => [col, { name: col, notNull: false, type: null }] as const)),
      foreignKeys: fks,
    });
  }
  return {
    id,
    prevIds: opts.prevIds ?? [],
    tables: map,
    renames: opts.renames ?? { tables: [], columns: [] },
  };
}
