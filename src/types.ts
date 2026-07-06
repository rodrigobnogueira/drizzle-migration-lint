/** Dialects as they appear in drizzle-kit artifacts, normalized: the v1
 * snapshot literal `postgres` is mapped to `postgresql` on read. */
export type Dialect =
  | 'postgresql'
  | 'mysql'
  | 'sqlite'
  | 'turso'
  | 'singlestore'
  | 'gel'
  | 'mssql'
  | 'cockroach';

/** `legacy` = drizzle-kit ≤0.31.x (`meta/_journal.json` + `NNNN_*.sql`);
 * `v1` = drizzle-kit ≥1.0.0 (one folder per migration, no journal). */
export type ArtifactFormat = 'legacy' | 'v1';

export type Severity = 'error' | 'warn';

export type RuleId =
  | 'create-index-non-concurrently'
  | 'add-column-not-null-no-default'
  | 'set-not-null'
  | 'alter-column-type'
  | 'add-fk-without-not-valid'
  | 'add-check-without-not-valid'
  | 'add-primary-key-on-existing-table'
  | 'volatile-default-on-add-column'
  | 'drop-column'
  | 'drop-table'
  | 'rename-column'
  | 'rename-table'
  | 'truncate-in-migration';

export interface SqlStatement {
  text: string;
  /** 1-based line in the migration file where the statement starts. */
  line: number;
}

export interface Finding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** The safe alternative, spelled out. */
  suggestion: string;
  /** Path of the migration SQL file, relative to the linted directory. */
  file: string;
  line: number;
  /** Migration id (legacy: journal tag; v1: folder name). */
  migration: string;
  suppressed: boolean;
  docsUrl: string;
}

/** Non-finding problems with the artifacts themselves (missing snapshot,
 * broken chain, ...). Reported, never fatal: linting continues best-effort. */
export interface Diagnostic {
  code:
    | 'missing-snapshot'
    | 'snapshot-chain-broken'
    | 'parallel-branches'
    | 'unreadable-file'
    | 'unknown-snapshot-version';
  message: string;
  migration?: string;
}

/** Normalized snapshot: only what the engine needs, one shape for every
 * artifact format and dialect. `tables` holds normalized identities
 * (`table` or `schema.table` for non-default pg schemas). */
export interface Snapshot {
  id: string;
  /** Legacy snapshots have exactly one predecessor (`prevId`); v1 snapshots
   * may have several (DAG). */
  prevIds: string[];
  tables: Set<string>;
}

export interface Migration {
  /** Stable id: legacy journal tag (`0001_lush_hulk`) or v1 folder name. */
  id: string;
  index: number;
  /** Relative to the linted directory. */
  sqlPath: string;
  sql: string;
  statements: SqlStatement[];
  snapshot: Snapshot | null;
  /** Post-state of the journal predecessor; null for the first migration. */
  prevSnapshot: Snapshot | null;
  isFirst: boolean;
}

export interface MigrationSet {
  format: ArtifactFormat;
  dialect: Dialect;
  dir: string;
  /** In application order. */
  migrations: Migration[];
  diagnostics: Diagnostic[];
}

export interface RuleContext {
  set: MigrationSet;
  migration: Migration;
  /** Tables created by this migration — every operation on them is exempt. */
  newTables: Set<string>;
}

export interface Rule {
  id: RuleId;
  severity: Severity;
  dialects: readonly Dialect[] | 'all';
  check(ctx: RuleContext): Finding[];
}

export interface LintSummary {
  errors: number;
  warnings: number;
  suppressed: number;
  migrationsChecked: number;
}

export interface LintResult {
  findings: Finding[];
  diagnostics: Diagnostic[];
  summary: LintSummary;
}
