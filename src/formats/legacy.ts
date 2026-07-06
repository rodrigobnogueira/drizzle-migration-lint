import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from '../errors';
import { normalizeDialect, normalizeLegacySnapshot } from '../snapshot';
import { splitStatements } from '../splitter';
import type { Diagnostic, Migration, MigrationSet, Snapshot } from '../types';

interface JournalEntry {
  idx: number;
  tag: string;
}

function readJournal(dir: string): { dialect: string; entries: JournalEntry[] } {
  const journalPath = join(dir, 'meta', '_journal.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch (error) {
    throw new UsageError(`cannot parse ${journalPath}: ${(error as Error).message}`);
  }
  const journal = parsed as { dialect?: unknown; entries?: unknown };
  if (typeof journal.dialect !== 'string' || !Array.isArray(journal.entries)) {
    throw new UsageError(`${journalPath} does not look like a drizzle-kit journal`);
  }
  const entries = journal.entries
    .filter(
      (entry): entry is JournalEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as JournalEntry).idx === 'number' &&
        typeof (entry as JournalEntry).tag === 'string',
    )
    .sort((a, b) => a.idx - b.idx);
  return { dialect: journal.dialect, entries };
}

function readSnapshot(dir: string, entry: JournalEntry, diagnostics: Diagnostic[]): Snapshot | null {
  const snapshotPath = join('meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, snapshotPath), 'utf8'));
  } catch {
    diagnostics.push({
      code: 'missing-snapshot',
      message: `${snapshotPath} is missing or unreadable; structural analysis is disabled for this migration`,
      migration: entry.tag,
    });
    return null;
  }
  const snapshot = normalizeLegacySnapshot(raw);
  if (!snapshot) {
    diagnostics.push({
      code: 'unknown-snapshot-version',
      message: `${snapshotPath} has an unrecognized shape; structural analysis is disabled for this migration`,
      migration: entry.tag,
    });
  }
  return snapshot;
}

export function readLegacyMigrationSet(dir: string): MigrationSet {
  const { dialect: rawDialect, entries } = readJournal(dir);
  const dialect = normalizeDialect(rawDialect);
  if (!dialect) {
    throw new UsageError(`journal declares unknown dialect "${rawDialect}"`);
  }
  const diagnostics: Diagnostic[] = [];
  const migrations: Migration[] = [];
  for (const [position, entry] of entries.entries()) {
    const sqlPath = `${entry.tag}.sql`;
    let sql = '';
    try {
      sql = readFileSync(join(dir, sqlPath), 'utf8');
    } catch {
      diagnostics.push({
        code: 'unreadable-file',
        message: `${sqlPath} is missing or unreadable`,
        migration: entry.tag,
      });
    }
    const snapshot = readSnapshot(dir, entry, diagnostics);
    let prevSnapshot = position > 0 ? (migrations[position - 1]?.snapshot ?? null) : null;
    if (snapshot && prevSnapshot && snapshot.prevIds[0] !== prevSnapshot.id) {
      diagnostics.push({
        code: 'snapshot-chain-broken',
        message:
          `${entry.tag}: snapshot prevId does not match the previous journal entry's snapshot id; ` +
          'diffing across the gap would misattribute changes, so this migration is analyzed from its SQL only',
        migration: entry.tag,
      });
      // never bridge across a gap — cumulative changes would be blamed on this migration
      prevSnapshot = null;
    }
    migrations.push({
      id: entry.tag,
      index: position,
      sqlPath,
      sql,
      statements: splitStatements(sql),
      snapshot,
      prevSnapshot,
      isFirst: position === 0,
    });
  }
  return { format: 'legacy', dialect, dir, migrations, diagnostics };
}
