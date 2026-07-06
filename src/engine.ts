import { diffMigration } from './differ';
import { parseTableRef } from './identifiers';
import { loadPgParser, type PgParseFn } from './pg/ast';
import type { PgStatement } from './pg/nodes';
import { extractPgStatements } from './pg/walk';
import { RULES, ruleAppliesTo } from './rules';
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

/** Parses a migration's SQL, tolerating a hand-edited file the real parser
 * rejects (skip the AST layer for that file rather than crash the run). */
function parsePgStatements(parse: PgParseFn, migration: Migration): PgStatement[] {
  try {
    return extractPgStatements(parse, migration.sql);
  } catch {
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
}

export async function lint(set: MigrationSet, options: LintOptions = {}): Promise<LintResult> {
  const loadParser = options.loadParser ?? loadPgParser;
  const diagnostics: Diagnostic[] = [...set.diagnostics];
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
    const newTables = computeNewTables(migration);
    const context: RuleContext = {
      set,
      migration,
      newTables,
      diffOps: diffMigration(migration),
      pgStatements: pgParse ? parsePgStatements(pgParse, migration) : [],
    };
    const migrationFindings: Finding[] = [];
    for (const rule of RULES) {
      if (ruleAppliesTo(rule, set.dialect)) {
        migrationFindings.push(...rule.check(context));
      }
    }
    if (degraded) {
      migrationFindings.push(...degradedPgScan(migration, newTables));
    }
    // suppression directives are file-scoped, so resolve them per migration
    applySuppressions(migrationFindings, migration.sql, migration.statements);
    findings.push(...migrationFindings);
  }
  findings.sort(compareFindings);
  return { findings, diagnostics, summary: summarize(findings, set.migrations.length) };
}
