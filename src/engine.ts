import { diffMigration } from './differ';
import { parseTableRef } from './identifiers';
import { RULES, ruleAppliesTo } from './rules';
import { applySuppressions } from './suppressions';
import type { Finding, LintResult, Migration, MigrationSet, SqlStatement } from './types';

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

export function lint(set: MigrationSet): LintResult {
  const findings: Finding[] = [];
  for (const migration of set.migrations) {
    const context = {
      set,
      migration,
      newTables: computeNewTables(migration),
      diffOps: diffMigration(migration),
    };
    const migrationFindings: Finding[] = [];
    for (const rule of RULES) {
      if (ruleAppliesTo(rule, set.dialect)) {
        migrationFindings.push(...rule.check(context));
      }
    }
    // suppression directives are file-scoped, so resolve them per migration
    applySuppressions(migrationFindings, migration.sql, migration.statements);
    findings.push(...migrationFindings);
  }
  findings.sort(compareFindings);
  const active = findings.filter((finding) => !finding.suppressed);
  return {
    findings,
    diagnostics: set.diagnostics,
    summary: {
      errors: active.filter((finding) => finding.severity === 'error').length,
      warnings: active.filter((finding) => finding.severity === 'warn').length,
      suppressed: findings.length - active.length,
      migrationsChecked: set.migrations.length,
    },
  };
}
