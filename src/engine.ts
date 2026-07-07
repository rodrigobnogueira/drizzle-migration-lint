import { formatBytes } from './bytes';
import type { SeverityOverride } from './config';
import { diffMigration } from './differ';
import { parseTableRef } from './identifiers';
import { loadPgParser, type PgParseFn } from './pg/ast';
import type { PgStatement } from './pg/nodes';
import { extractPgStatements } from './pg/walk';
import { RULES, SIZE_SENSITIVE_RULES, ruleAppliesTo } from './rules';
import { degradedPgScan } from './rules/pg/degraded';
import { applySuppressions } from './suppressions';
import type {
  Diagnostic,
  Finding,
  LintResult,
  LintSummary,
  Migration,
  MigrationSet,
  RuleContext,
  RuleId,
  SqlStatement,
} from './types';

/** Reporting order: by file, then line within a file, then rule id so two
 * rules firing on the same statement have a stable order. */
export function compareFindings(a: Finding, b: Finding): number {
  return a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule);
}

const CREATE_TABLE = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i;

/** Fallback for migrations without a usable snapshot pair: any table this
 * migration itself creates is still exempt. */
function harvestCreatedTables(statements: readonly SqlStatement[]): Set<string> {
  const tables = new Set<string>();
  for (const statement of statements) {
    const match = CREATE_TABLE.exec(statement.text);
    if (match) {
      tables.add(parseTableRef(match[1] as string));
    }
  }
  return tables;
}

/** Tables that did not exist before this migration. First migration in the
 * history → everything is new (a fresh project's bootstrap lints clean). */
export function computeNewTables(migration: Migration): Set<string> {
  const { snapshot, prevSnapshot } = migration;
  if (snapshot && migration.isFirst) {
    return new Set(snapshot.tables.keys());
  }
  if (snapshot && prevSnapshot) {
    const created = new Set<string>();
    for (const table of snapshot.tables.keys()) {
      if (!prevSnapshot.tables.has(table)) {
        created.add(table);
      }
    }
    return created;
  }
  return harvestCreatedTables(migration.statements);
}

/** Parses a migration's SQL, tolerating a file the real parser rejects: skip
 * the statement layer for it rather than crash the run — but surface a
 * diagnostic so a silently-unchecked migration never reads as "clean". */
function parsePgStatements(
  parse: PgParseFn,
  migration: Migration,
  diagnostics: Diagnostic[],
): PgStatement[] {
  try {
    return extractPgStatements(parse, migration.sql);
  } catch {
    diagnostics.push({
      code: 'pg-statements-unparsed',
      message:
        `${migration.sqlPath}: the Postgres parser could not read this migration, so its ` +
        'statement-level rules were skipped (structural rules still ran). This usually means ' +
        'hand-edited SQL or syntax newer than the bundled parser.',
      migration: migration.id,
    });
    return [];
  }
}

function summarize(findings: Finding[], migrationsChecked: number): LintSummary {
  const active = findings.filter((finding) => !finding.suppressed);
  return {
    errors: active.filter((finding) => finding.severity === 'error').length,
    warnings: active.filter((finding) => finding.severity === 'warn').length,
    suppressed: findings.length - active.length,
    migrationsChecked,
  };
}

export interface LintOptions {
  /** Override the Postgres parser loader — the seam tests use to exercise the
   * degraded and parse-error paths. Defaults to the real WASM loader. */
  loadParser?: () => Promise<PgParseFn | null>;
  /** Per-rule severity overrides from config; `off` drops the rule's findings
   * entirely. */
  severityOverrides?: Partial<Record<RuleId, SeverityOverride>>;
  /** Restricts which migrations are linted (scoping). Out-of-scope migrations
   * still serve as snapshot predecessors. Defaults to all in scope. */
  inScope?: (migrationId: string) => boolean;
  /** Extra diagnostics from scope resolution, surfaced in the result. */
  extraDiagnostics?: Diagnostic[];
  /** Live on-disk table sizes (bytes). When set, lock/rewrite findings on
   * tables at or below `sizeThreshold` are suppressed as low-risk. */
  tableSizes?: Map<string, number>;
  /** Byte threshold for `tableSizes` exemption (default 16 MiB). */
  sizeThreshold?: number;
}

/** Default size-exemption threshold: 16 MiB. A lock or rewrite on a table this
 * small completes in well under a second. */
export const DEFAULT_SIZE_THRESHOLD = 16 * 1024 * 1024;

/** Suppresses lock/rewrite findings on tables at or below the size threshold —
 * the lock is too brief to matter. Findings stay visible (suppressed count)
 * with the size noted; only truly size-sensitive rules are eligible. */
export function applySizeExemptions(
  findings: Finding[],
  sizes: Map<string, number>,
  threshold: number,
): void {
  for (const finding of findings) {
    if (finding.suppressed) {
      continue;
    }
    if (!SIZE_SENSITIVE_RULES.has(finding.rule) || finding.table === undefined) {
      continue;
    }
    const bytes = sizes.get(finding.table);
    if (bytes !== undefined && bytes <= threshold) {
      finding.suppressed = true;
      finding.message +=
        ` (table "${finding.table}" is ${formatBytes(bytes)}, at or below the ` +
        `${formatBytes(threshold)} threshold — the lock is brief.)`;
    }
  }
}

/** Applies config severity overrides: remaps a finding's severity, or drops it
 * when the rule is set to `off`. */
function applySeverityOverrides(
  findings: Finding[],
  overrides: Partial<Record<RuleId, SeverityOverride>> | undefined,
): Finding[] {
  if (!overrides) {
    return findings;
  }
  const kept: Finding[] = [];
  for (const finding of findings) {
    const override = overrides[finding.rule];
    if (override === 'off') {
      continue;
    }
    if (override !== undefined) {
      finding.severity = override;
    }
    kept.push(finding);
  }
  return kept;
}

/** Runs every applicable rule (plus degraded scan and suppressions) against a
 * single migration. */
function lintMigration(
  set: MigrationSet,
  migration: Migration,
  pgParse: PgParseFn | null,
  degraded: boolean,
  diagnostics: Diagnostic[],
): Finding[] {
  const newTables = computeNewTables(migration);
  const context: RuleContext = {
    set,
    migration,
    newTables,
    diffOps: diffMigration(migration),
    pgStatements: pgParse ? parsePgStatements(pgParse, migration, diagnostics) : [],
  };
  const findings: Finding[] = [];
  for (const rule of RULES) {
    if (ruleAppliesTo(rule, set.dialect)) {
      findings.push(...rule.check(context));
    }
  }
  if (degraded) {
    findings.push(...degradedPgScan(migration, newTables));
  }
  // suppression directives are file-scoped, so resolve them per migration
  applySuppressions(findings, migration.sql, migration.statements);
  return findings;
}

export async function lint(set: MigrationSet, options: LintOptions = {}): Promise<LintResult> {
  const loadParser = options.loadParser ?? loadPgParser;
  const diagnostics: Diagnostic[] = [...set.diagnostics, ...(options.extraDiagnostics ?? [])];
  const pgParse = set.dialect === 'postgresql' ? await loadParser() : null;
  const degraded = set.dialect === 'postgresql' && pgParse === null;
  if (degraded) {
    diagnostics.push({
      code: 'pg-parser-unavailable',
      message:
        'the Postgres SQL parser could not be loaded; Postgres rules ran in a reduced regex-only mode',
    });
  }

  const findings: Finding[] = [];
  for (const migration of set.migrations) {
    // out-of-scope migrations are skipped, but their snapshots still anchor successors
    if (!options.inScope || options.inScope(migration.id)) {
      findings.push(...lintMigration(set, migration, pgParse, degraded, diagnostics));
    }
  }
  const finalFindings = applySeverityOverrides(findings, options.severityOverrides);
  if (options.tableSizes) {
    applySizeExemptions(finalFindings, options.tableSizes, options.sizeThreshold ?? DEFAULT_SIZE_THRESHOLD);
  }
  finalFindings.sort(compareFindings);
  return {
    findings: finalFindings,
    diagnostics,
    summary: summarize(finalFindings, set.migrations.length),
  };
}
