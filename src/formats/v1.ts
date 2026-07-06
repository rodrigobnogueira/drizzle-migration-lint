import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../errors';
import { normalizeV1Snapshot, v1SnapshotDialect } from '../snapshot';
import { splitStatements } from '../splitter';
import type { Diagnostic, Dialect, Migration, MigrationSet, NormalizedTable, Snapshot } from '../types';
import { V1_FOLDER } from './detect';

interface V1Folder {
  name: string;
  sql: string;
  snapshot: Snapshot | null;
}

function readFolders(dir: string, diagnostics: Diagnostic[]): V1Folder[] {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && V1_FOLDER.test(entry.name))
    .map((entry) => entry.name)
    // the 14-digit UTC timestamp prefix makes lexicographic = chronological
    .sort();
  return names.map((name) => {
    let sql = '';
    try {
      sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
    } catch {
      diagnostics.push({
        code: 'unreadable-file',
        message: `${name}/migration.sql is missing or unreadable`,
        migration: name,
      });
    }
    let snapshot: Snapshot | null = null;
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, name, 'snapshot.json'), 'utf8'));
      snapshot = normalizeV1Snapshot(raw);
      if (!snapshot) {
        diagnostics.push({
          code: 'unknown-snapshot-version',
          message: `${name}/snapshot.json has an unrecognized shape; structural analysis is disabled for this migration`,
          migration: name,
        });
      }
    } catch {
      diagnostics.push({
        code: 'missing-snapshot',
        message: `${name}/snapshot.json is missing or unreadable; structural analysis is disabled for this migration`,
        migration: name,
      });
    }
    return { name, sql, snapshot };
  });
}

function detectDialect(dir: string, folders: V1Folder[], override: Dialect | undefined): Dialect {
  for (const folder of folders) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, folder.name, 'snapshot.json'), 'utf8'));
      const dialect = v1SnapshotDialect(raw);
      if (dialect) {
        return dialect;
      }
    } catch {
      // fall through to the next folder / the override
    }
  }
  if (override) {
    return override;
  }
  throw new UsageError(
    'cannot determine the dialect from any snapshot in this directory — pass --dialect',
  );
}

/** Combined predecessor for a snapshot with (possibly several) parents: a
 * table pre-existed if ANY parent had it — the conservative reading for the
 * new-table exemption. */
function resolvePrev(
  snapshot: Snapshot,
  byId: Map<string, Snapshot>,
  name: string,
  diagnostics: Diagnostic[],
): Snapshot | null {
  if (snapshot.prevIds.length === 0) {
    return null; // root: prevIds held only the zero-UUID sentinel
  }
  const parents = snapshot.prevIds
    .map((id) => byId.get(id))
    .filter((parent): parent is Snapshot => parent !== undefined);
  if (parents.length !== snapshot.prevIds.length) {
    diagnostics.push({
      code: 'snapshot-chain-broken',
      message:
        `${name}: a prevId does not match any snapshot in this directory; ` +
        'diffing across the gap would misattribute changes, so this migration is analyzed from its SQL only',
      migration: name,
    });
    return null;
  }
  if (parents.length === 1) {
    return parents[0] as Snapshot;
  }
  // A table/column pre-existed if ANY parent had it — union the parents so the
  // new-table exemption and column diffs stay conservative across a merge.
  const tables = new Map<string, NormalizedTable>();
  for (const parent of parents) {
    for (const [identity, table] of parent.tables) {
      const merged = tables.get(identity) ?? { ...table, columns: new Map(table.columns) };
      for (const [colName, column] of table.columns) {
        merged.columns.set(colName, column);
      }
      tables.set(identity, merged);
    }
  }
  return {
    id: snapshot.prevIds.join('+'),
    prevIds: [],
    tables,
    renames: { tables: [], columns: [] },
  };
}

function checkForParallelBranches(folders: V1Folder[], diagnostics: Diagnostic[]): void {
  const referenced = new Set<string>();
  const present: Snapshot[] = [];
  for (const folder of folders) {
    if (folder.snapshot) {
      present.push(folder.snapshot);
      for (const id of folder.snapshot.prevIds) {
        referenced.add(id);
      }
    }
  }
  const leaves = present.filter((snapshot) => !referenced.has(snapshot.id));
  if (leaves.length > 1) {
    diagnostics.push({
      code: 'parallel-branches',
      message:
        `migration history has ${leaves.length} heads (parallel branches generated from the same parent); ` +
        'run `drizzle-kit check` to resolve the conflict — all branches are linted',
    });
  }
}

export function readV1MigrationSet(dir: string, dialectOverride?: Dialect): MigrationSet {
  const diagnostics: Diagnostic[] = [];
  const folders = readFolders(dir, diagnostics);
  const dialect = detectDialect(dir, folders, dialectOverride);
  const byId = new Map<string, Snapshot>();
  for (const folder of folders) {
    if (folder.snapshot) {
      byId.set(folder.snapshot.id, folder.snapshot);
    }
  }
  checkForParallelBranches(folders, diagnostics);
  const migrations: Migration[] = folders.map((folder, position) => ({
    id: folder.name,
    index: position,
    sqlPath: `${folder.name}/migration.sql`,
    sql: folder.sql,
    statements: splitStatements(folder.sql),
    snapshot: folder.snapshot,
    prevSnapshot: folder.snapshot
      ? resolvePrev(folder.snapshot, byId, folder.name, diagnostics)
      : null,
    isFirst: folder.snapshot !== null && folder.snapshot.prevIds.length === 0,
  }));
  return { format: 'v1', dialect, dir, migrations, diagnostics };
}
