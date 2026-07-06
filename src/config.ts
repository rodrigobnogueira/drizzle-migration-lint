import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { UsageError } from './errors';
import { normalizeDialect } from './snapshot';
import type { Dialect, RuleId, Severity } from './types';

export type SeverityOverride = Severity | 'off';

export interface DmlConfig {
  dir?: string;
  dialect?: string;
  /** The last reviewed migration id; runs skip everything up to and including
   * it unless --since/--all is given. */
  baseline?: { tag: string };
  rules?: Partial<Record<RuleId, SeverityOverride>>;
}

export const CONFIG_BASENAME = '.drizzle-migration-lint.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface LoadedConfig {
  config: DmlConfig;
  /** Absolute path the config was read from, or null when none exists. */
  path: string | null;
}

/** Resolves a --config value (or the default) to an absolute path. */
export function configPathFor(cwd: string, configPath?: string): string {
  if (!configPath) {
    return join(cwd, CONFIG_BASENAME);
  }
  return isAbsolute(configPath) ? configPath : join(cwd, configPath);
}

/** Reads and validates a config file at an absolute path. Malformed JSON or a
 * non-object is a usage error. User configs are DATA, never executed. */
export function parseConfigFile(path: string): DmlConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new UsageError(`cannot parse ${path}: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) {
    throw new UsageError(`${path} must contain a JSON object`);
  }
  return parsed as DmlConfig;
}

/** Loads `.drizzle-migration-lint.json` (or an explicit --config path). A
 * missing default file is fine (empty config); a missing EXPLICIT file is a
 * usage error. */
export function loadConfig(cwd: string, configPath?: string): LoadedConfig {
  const path = configPathFor(cwd, configPath);
  if (!existsSync(path)) {
    if (configPath !== undefined) {
      throw new UsageError(`config file not found: ${path}`);
    }
    return { config: {}, path: null };
  }
  return { config: parseConfigFile(path), path };
}

const CONFIG_BASENAMES = [
  'drizzle.config.ts',
  'drizzle.config.js',
  'drizzle.config.mjs',
  'drizzle.config.cjs',
];

/** Best-effort, deliberately dumb extraction: user configs are NEVER
 * executed (no jiti/ts-node) — a regex either finds `out:`/`dialect:` string
 * literals or we fall back to ./drizzle. */
function scanDrizzleConfig(cwd: string): { out?: string; dialect?: Dialect } {
  for (const basename of CONFIG_BASENAMES) {
    const path = join(cwd, basename);
    if (!existsSync(path)) {
      continue;
    }
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return {};
    }
    const out = /\bout\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1];
    const dialectLiteral = /\bdialect\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1];
    return {
      out,
      dialect: dialectLiteral ? (normalizeDialect(dialectLiteral) ?? undefined) : undefined,
    };
  }
  return {};
}

export interface ResolvedLocation {
  dir: string;
  dialect: Dialect | undefined;
  /** Where the directory came from — surfaced in --help debugging and tests. */
  source: 'flags' | 'config' | 'drizzle-config' | 'default';
}

function resolveDir(cwd: string, dir: string): string {
  return isAbsolute(dir) ? dir : join(cwd, dir);
}

/** Directory/dialect precedence: CLI flags > config file > drizzle.config
 * regex > ./drizzle. */
export function resolveLocation(
  cwd: string,
  flagDir: string | undefined,
  flagDialect: Dialect | undefined,
  config: DmlConfig = {},
): ResolvedLocation {
  const configDialect = config.dialect ? (normalizeDialect(config.dialect) ?? undefined) : undefined;
  if (flagDir) {
    return { dir: resolveDir(cwd, flagDir), dialect: flagDialect ?? configDialect, source: 'flags' };
  }
  if (config.dir) {
    return { dir: resolveDir(cwd, config.dir), dialect: flagDialect ?? configDialect, source: 'config' };
  }
  const scanned = scanDrizzleConfig(cwd);
  if (scanned.out) {
    return {
      dir: resolveDir(cwd, scanned.out),
      dialect: flagDialect ?? configDialect ?? scanned.dialect,
      source: 'drizzle-config',
    };
  }
  return {
    dir: join(cwd, 'drizzle'),
    dialect: flagDialect ?? configDialect ?? scanned.dialect,
    source: 'default',
  };
}
