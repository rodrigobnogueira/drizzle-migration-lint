import type { Dialect, MigrationSet } from '../types';
import { detectFormat } from './detect';
import { readLegacyMigrationSet } from './legacy';
import { readV1MigrationSet } from './v1';

export { detectFormat } from './detect';

export interface ReadOptions {
  /** Only consulted when the artifacts themselves don't say (v1 directory
   * where every snapshot is missing). */
  dialect?: Dialect;
}

export function readMigrationSet(dir: string, options: ReadOptions = {}): MigrationSet {
  const format = detectFormat(dir);
  if (format === 'legacy') {
    return readLegacyMigrationSet(dir);
  }
  return readV1MigrationSet(dir, options.dialect);
}
