import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { normalizeDialect } from './snapshot';
import type { Dialect } from './types';

export interface ResolvedLocation {
  dir: string;
  dialect: Dialect | undefined;
  /** Where the values came from — surfaced in --help debugging and tests. */
  source: 'flags' | 'drizzle-config' | 'default';
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

export function resolveLocation(
  cwd: string,
  flagDir: string | undefined,
  flagDialect: Dialect | undefined,
): ResolvedLocation {
  if (flagDir) {
    const dir = isAbsolute(flagDir) ? flagDir : join(cwd, flagDir);
    return { dir, dialect: flagDialect, source: 'flags' };
  }
  const scanned = scanDrizzleConfig(cwd);
  if (scanned.out) {
    const dir = isAbsolute(scanned.out) ? scanned.out : join(cwd, scanned.out);
    return { dir, dialect: flagDialect ?? scanned.dialect, source: 'drizzle-config' };
  }
  return { dir: join(cwd, 'drizzle'), dialect: flagDialect ?? scanned.dialect, source: 'default' };
}
