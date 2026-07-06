import { execFileSync } from 'node:child_process';
import { relative } from 'node:path';
import type { Diagnostic, MigrationSet } from './types';

export interface ScopeOptions {
  /** git ref: lint only migrations absent at that ref (PR/CI mode). */
  since?: string;
  /** lint the entire history regardless of baseline. */
  all?: boolean;
  /** config baseline: skip everything up to and including this migration id. */
  baseline?: { tag: string };
}

export interface ResolvedScope {
  inScope: (migrationId: string) => boolean;
  diagnostics: Diagnostic[];
}

const V1_FOLDER = /^\d{14}_./;
const ALL_IN_SCOPE: ResolvedScope = { inScope: () => true, diagnostics: [] };

/** Runs git from the repo root; returns null on any failure so callers can
 * fail safe. */
function git(root: string, args: string[]): string | null {
  try {
    // resolving `git` from PATH is the intended behavior for a CLI tool
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function repoRoot(dir: string): string | null {
  return git(dir, ['rev-parse', '--show-toplevel'])?.trim() ?? null;
}

/** The set of migration ids present in the linted directory at a git ref, or
 * null when it can't be read (detached path, unknown ref, ...). */
function idsAtRef(set: MigrationSet, ref: string): Set<string> | null {
  const root = repoRoot(set.dir);
  if (root === null) {
    return null;
  }
  const rel = relative(root, set.dir);
  if (set.format === 'legacy') {
    const journal = git(root, ['show', `${ref}:${rel}/meta/_journal.json`]);
    if (journal === null) {
      return null;
    }
    try {
      const entries = (JSON.parse(journal) as { entries?: { tag?: string }[] }).entries ?? [];
      return new Set(entries.map((entry) => entry.tag).filter((tag): tag is string => typeof tag === 'string'));
    } catch {
      return null;
    }
  }
  const tree = git(root, ['ls-tree', '--name-only', `${ref}:${rel}`]);
  if (tree === null) {
    return null;
  }
  return new Set(
    tree
      .split('\n')
      .map((name) => name.trim())
      .filter((name) => V1_FOLDER.test(name)),
  );
}

function isSubset(subset: Set<string>, superset: Set<string>): boolean {
  for (const value of subset) {
    if (!superset.has(value)) {
      return false;
    }
  }
  return true;
}

function staleScope(message: string): ResolvedScope {
  // fail safe: when the reference point is unusable, lint everything
  return { inScope: () => true, diagnostics: [{ code: 'baseline-stale', message }] };
}

function sinceScope(set: MigrationSet, ref: string): ResolvedScope {
  const past = idsAtRef(set, ref);
  const current = new Set(set.migrations.map((migration) => migration.id));
  if (past === null || !isSubset(past, current)) {
    return staleScope(
      `could not compare against "${ref}" (unreadable ref or rewritten/squashed history); linting all migrations`,
    );
  }
  return { inScope: (id) => !past.has(id), diagnostics: [] };
}

function baselineScope(set: MigrationSet, tag: string): ResolvedScope {
  const order = set.migrations.map((migration) => migration.id);
  const index = order.indexOf(tag);
  if (index === -1) {
    return staleScope(`baseline migration "${tag}" is no longer present; linting all migrations`);
  }
  const after = new Set(order.slice(index + 1));
  return { inScope: (id) => after.has(id), diagnostics: [] };
}

/** Resolves which migrations to lint. Precedence: --all > --since > config
 * baseline > everything. */
export function resolveScope(set: MigrationSet, options: ScopeOptions): ResolvedScope {
  if (options.all) {
    return ALL_IN_SCOPE;
  }
  if (options.since !== undefined) {
    return sinceScope(set, options.since);
  }
  if (options.baseline) {
    return baselineScope(set, options.baseline.tag);
  }
  return ALL_IN_SCOPE;
}
