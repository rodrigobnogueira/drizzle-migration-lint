import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../errors';
import type { ArtifactFormat } from '../types';

/** v1 folders are `<YYYYMMDDHHMMSS>_<name>` (UTC timestamp). */
export const V1_FOLDER = /^\d{14}_./;

export function detectFormat(dir: string): ArtifactFormat {
  if (existsSync(join(dir, 'meta', '_journal.json'))) {
    return 'legacy';
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new UsageError(`cannot read migrations directory "${dir}" — pass --dir`);
  }
  const hasV1Folder = entries.some(
    (entry) =>
      entry.isDirectory() &&
      V1_FOLDER.test(entry.name) &&
      existsSync(join(dir, entry.name, 'migration.sql')),
  );
  if (hasV1Folder) {
    return 'v1';
  }
  throw new UsageError(
    `"${dir}" is not a drizzle-kit migrations directory: found neither meta/_journal.json ` +
      '(legacy layout) nor <timestamp>_<name>/migration.sql folders (v1 layout)',
  );
}
