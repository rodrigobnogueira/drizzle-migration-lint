import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
