import type { ParseResult } from './nodes';

export type PgParseFn = (sql: string) => ParseResult;

interface LibpgModule {
  loadModule: () => Promise<unknown>;
  parseSync: (sql: string) => ParseResult;
}

export type ModuleImporter = () => Promise<LibpgModule>;

/** Lazy dynamic import: sqlite/mysql users never load the WASM parser. */
const defaultImporter: ModuleImporter = () =>
  import('libpg-query') as unknown as Promise<LibpgModule>;

let cached: Promise<PgParseFn | null> | null = null;

async function attemptLoad(importer: ModuleImporter): Promise<PgParseFn | null> {
  try {
    const mod = await importer();
    // parseSync needs the WASM module instantiated first (one-time, async)
    await mod.loadModule();
    return (sql: string) => mod.parseSync(sql);
  } catch {
    // unsupported platform / WASM failure → caller degrades to regex mode
    return null;
  }
}

/** Resolves to a synchronous parse function, or null when the parser can't be
 * loaded. The default-importer result is memoized (load the WASM once); tests
 * pass their own importer and bypass the cache. */
export async function loadPgParser(importer?: ModuleImporter): Promise<PgParseFn | null> {
  if (importer) {
    return attemptLoad(importer);
  }
  cached ??= attemptLoad(defaultImporter);
  return cached;
}
