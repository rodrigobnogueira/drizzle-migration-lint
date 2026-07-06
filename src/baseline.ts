import { existsSync, writeFileSync } from 'node:fs';
import { configPathFor, parseConfigFile, type DmlConfig } from './config';
import { UsageError } from './errors';
import type { MigrationSet } from './types';

export interface BaselineResult {
  tag: string;
  path: string;
}

/** Marks the latest migration as the baseline in `.drizzle-migration-lint.json`,
 * preserving every other key. Unlike `check`, an explicit --config path need
 * not exist yet — baseline creates it. The writer is injectable for testing. */
export function runBaseline(
  cwd: string,
  set: MigrationSet,
  configPath: string | undefined,
  write: (path: string, data: string) => void = writeFileSync,
): BaselineResult {
  const last = set.migrations[set.migrations.length - 1];
  if (!last) {
    throw new UsageError('no migrations found to baseline');
  }
  const path = configPathFor(cwd, configPath);
  const config: DmlConfig = existsSync(path) ? parseConfigFile(path) : {};
  config.baseline = { tag: last.id };
  write(path, `${JSON.stringify(config, null, 2)}\n`);
  return { tag: last.id, path };
}
