import type { PgStatement } from './pg/nodes';

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
  | 'add-unique-constraint'
  | 'volatile-default-on-add-column'
  | 'add-enum-value'
  | 'drop-column'
  | 'drop-table'
  | 'rename-column'
  | 'rename-table'
  | 'recreate-cascade-data-loss'
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
  /** Normalized identity of the table the finding concerns, when it concerns a
   * single one — used to match findings to live table sizes for size-exemption. */
  table?: string;
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
    | 'unknown-snapshot-version'
    | 'pg-parser-unavailable'
    | 'pg-statements-unparsed'
    | 'introspection-failed'
    | 'baseline-stale';
  message: string;
  migration?: string;
}

export interface NormalizedColumn {
  name: string;
  notNull: boolean;
  /** Raw type string as recorded in the snapshot (`bigint`, `varchar(255)`),
   * or null when the artifact omitted it. Used as the FROM type for
   * alter-column-type widening analysis. */
  type: string | null;
}

export interface NormalizedForeignKey {
  name: string;
  /** Normalized identity of the referenced table (this FK's parent). */
  tableTo: string;
  /** `onDelete` action, lowercased (`cascade`, `set null`, `no action`, ...) —
   * legacy snapshots store it lowercase, v1 uppercase, so it is normalized. */
  onDelete: string;
}

export interface NormalizedTable {
  /** `table` or `schema.table` for non-default pg schemas. */
  identity: string;
  name: string;
  schema: string | null;
  columns: Map<string, NormalizedColumn>;
  /** Foreign keys declared on this table, keyed by constraint name. */
  foreignKeys: Map<string, NormalizedForeignKey>;
}

export interface RenamePair {
  from: string;
  to: string;
}

export interface ColumnRenamePair {
  table: string;
  from: string;
  to: string;
}

/** Rename hints drizzle-kit records for the transition INTO this snapshot
 * (legacy `_meta`, v1 `renames[]`). SQL `RENAME` statements are the
 * authoritative signal; these corroborate — and cover sqlite's
 * table-recreate dance, where the SQL carries no clean `RENAME`. */
export interface RenameHints {
  tables: RenamePair[];
  columns: ColumnRenamePair[];
}

/** Normalized snapshot: only what the engine needs, one shape for every
 * artifact format and dialect. */
export interface Snapshot {
  id: string;
  /** Legacy snapshots have exactly one predecessor (`prevId`); v1 snapshots
   * may have several (DAG). */
  prevIds: string[];
  tables: Map<string, NormalizedTable>;
  renames: RenameHints;
}

/** Semantic operations the structural differ emits for one migration, after
 * resolving renames. Table-level ops (`drop-table`, `rename-table`) concern
 * tables that existed before this migration by construction; column ops carry
 * the containing table's identity. */
export type DiffOpBody =
  | { kind: 'drop-table'; table: string }
  | { kind: 'rename-table'; from: string; to: string }
  | { kind: 'drop-column'; table: string; column: string }
  | { kind: 'rename-column'; table: string; from: string; to: string };

/** A `DiffOpBody` plus the 1-based source line of the driving SQL statement,
 * or 1 when the operation is visible only in the snapshot diff (e.g. sqlite's
 * table-recreate dance). */
export type DiffOp = DiffOpBody & { line: number };

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
  /** Structural diff of this migration (prev → next snapshot, renames
   * resolved); empty when there is no snapshot pair to diff. */
  diffOps: DiffOp[];
  /** Parsed Postgres statements for this migration; empty for non-pg dialects
   * and when the parser is unavailable (degraded mode). */
  pgStatements: PgStatement[];
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
