import { parseTableRef } from '../../identifiers';
import type { Finding, Migration, RuleId } from '../../types';
import { docsUrlFor } from '../docs-url';

/** Regex-degraded Postgres scan, used ONLY when the real parser can't load.
 * It covers the two highest-severity token patterns the handover calls out —
 * non-concurrent index builds and constraints added without NOT VALID — and
 * deliberately nothing subtler, since regexes can't safely go further. */

const CREATE_INDEX = /^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i;
const CONCURRENTLY = /\bCONCURRENTLY\b/i;
const INDEX_TARGET = /\bON\s+(?:ONLY\s+)?("?[\w.]+"?)/i;
const ADD_CONSTRAINT = /\bADD\s+CONSTRAINT\b/i;
const IS_FK = /\bFOREIGN\s+KEY\b/i;
const IS_CHECK = /\bCHECK\b/i;
const NOT_VALID = /\bNOT\s+VALID\b/i;
const ALTER_TARGET = /^ALTER\s+TABLE\s+(?:ONLY\s+)?("?[\w.]+"?)/i;

function degradedFinding(
  migration: Migration,
  id: RuleId,
  line: number,
  message: string,
): Finding {
  return {
    rule: id,
    severity: 'error',
    message: `${message} (detected in regex-degraded mode — the SQL parser was unavailable).`,
    suggestion: 'See the rule docs for the safe rewrite.',
    file: migration.sqlPath,
    line,
    migration: migration.id,
    suppressed: false,
    docsUrl: docsUrlFor(id),
  };
}

function targetTable(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match ? parseTableRef(match[1] as string) : null;
}

function scanIndex(text: string, line: number, migration: Migration, newTables: Set<string>): Finding | null {
  if (!CREATE_INDEX.test(text) || CONCURRENTLY.test(text)) {
    return null;
  }
  const table = targetTable(text, INDEX_TARGET);
  if (table !== null && newTables.has(table)) {
    return null;
  }
  return degradedFinding(
    migration,
    'create-index-non-concurrently',
    line,
    `Creating an index without CONCURRENTLY blocks writes for the whole build`,
  );
}

function scanConstraint(text: string, line: number, migration: Migration, newTables: Set<string>): Finding | null {
  if (!ADD_CONSTRAINT.test(text) || NOT_VALID.test(text)) {
    return null;
  }
  const table = targetTable(text, ALTER_TARGET);
  if (table !== null && newTables.has(table)) {
    return null;
  }
  if (IS_FK.test(text)) {
    return degradedFinding(migration, 'add-fk-without-not-valid', line, `Adding a foreign key without NOT VALID scans and locks both tables`);
  }
  if (IS_CHECK.test(text)) {
    return degradedFinding(migration, 'add-check-without-not-valid', line, `Adding a CHECK without NOT VALID scans the whole table under a lock`);
  }
  return null;
}

export function degradedPgScan(migration: Migration, newTables: Set<string>): Finding[] {
  const findings: Finding[] = [];
  for (const statement of migration.statements) {
    const index = scanIndex(statement.text, statement.line, migration, newTables);
    if (index) {
      findings.push(index);
    }
    const constraint = scanConstraint(statement.text, statement.line, migration, newTables);
    if (constraint) {
      findings.push(constraint);
    }
  }
  return findings;
}
