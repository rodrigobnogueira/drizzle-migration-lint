import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UsageError } from '../../src/errors';
import { detectFormat, readMigrationSet } from '../../src/formats';
import { ZERO, journalJson, legacySnapshotJson, tempTree, v1SnapshotJson } from '../support/tmp';

// ---------- detectFormat ----------

test('detectFormat: meta/_journal.json → legacy', () => {
  const { dir, cleanup } = tempTree({ 'meta/_journal.json': journalJson('postgresql', ['0000_init']) });
  try {
    assert.equal(detectFormat(dir), 'legacy');
  } finally {
    cleanup();
  }
});

test('detectFormat: <timestamp>_name/migration.sql → v1', () => {
  const { dir, cleanup } = tempTree({ '20240101000000_init/migration.sql': 'SELECT 1;' });
  try {
    assert.equal(detectFormat(dir), 'v1');
  } finally {
    cleanup();
  }
});

test('detectFormat: legacy wins even if v1-looking folders coexist', () => {
  const { dir, cleanup } = tempTree({
    'meta/_journal.json': journalJson('sqlite', ['0000_init']),
    '20240101000000_init/migration.sql': 'SELECT 1;',
  });
  try {
    assert.equal(detectFormat(dir), 'legacy');
  } finally {
    cleanup();
  }
});

test('detectFormat: unreadable directory throws UsageError', () => {
  assert.throws(() => detectFormat('/no/such/dir/at/all'), UsageError);
});

test('detectFormat: a directory with neither layout throws UsageError', () => {
  const { dir, cleanup } = tempTree({ 'readme.txt': 'hi' });
  try {
    assert.throws(() => detectFormat(dir), /not a drizzle-kit migrations directory/);
  } finally {
    cleanup();
  }
});

test('detectFormat: a timestamp folder without migration.sql is ignored', () => {
  const { dir, cleanup } = tempTree({ '20240101000000_init/snapshot.json': '{}' });
  try {
    assert.throws(() => detectFormat(dir), UsageError);
  } finally {
    cleanup();
  }
});

// ---------- legacy reader ----------

test('legacy: reads chain, marks first migration, computes prevSnapshot', () => {
  const { dir, cleanup } = tempTree({
    'meta/_journal.json': journalJson('postgresql', ['0000_init', '0001_evolve']),
    '0000_init.sql': 'CREATE TABLE "users" ("id" serial);',
    '0001_evolve.sql': 'ALTER TABLE "users" ADD COLUMN "email" text;',
    'meta/0000_snapshot.json': legacySnapshotJson('id0', ZERO, { 'public.users': { name: 'users', schema: '' } }),
    'meta/0001_snapshot.json': legacySnapshotJson('id1', 'id0', { 'public.users': { name: 'users', schema: '' } }),
  });
  try {
    const set = readMigrationSet(dir);
    assert.equal(set.format, 'legacy');
    assert.equal(set.dialect, 'postgresql');
    assert.equal(set.migrations.length, 2);
    assert.equal(set.migrations[0]!.isFirst, true);
    assert.equal(set.migrations[0]!.prevSnapshot, null);
    assert.equal(set.migrations[1]!.prevSnapshot?.id, 'id0');
    assert.equal(set.diagnostics.length, 0);
  } finally {
    cleanup();
  }
});

test('legacy: missing snapshot file → missing-snapshot diagnostic, reader continues', () => {
  const { dir, cleanup } = tempTree({
    'meta/_journal.json': journalJson('postgresql', ['0000_init']),
    '0000_init.sql': 'CREATE TABLE "users" ("id" serial);',
  });
  try {
    const set = readMigrationSet(dir);
    assert.equal(set.migrations[0]!.snapshot, null);
    assert.equal(set.diagnostics[0]!.code, 'missing-snapshot');
  } finally {
    cleanup();
  }
});

test('legacy: unrecognized snapshot shape → unknown-snapshot-version diagnostic', () => {
  const { dir, cleanup } = tempTree({
    'meta/_journal.json': journalJson('postgresql', ['0000_init']),
    '0000_init.sql': 'SELECT 1;',
    'meta/0000_snapshot.json': JSON.stringify({ garbage: true }),
  });
  try {
    const set = readMigrationSet(dir);
    assert.equal(set.diagnostics[0]!.code, 'unknown-snapshot-version');
  } finally {
    cleanup();
  }
});

test('legacy: missing SQL file → unreadable-file diagnostic', () => {
  const { dir, cleanup } = tempTree({
    'meta/_journal.json': journalJson('postgresql', ['0000_init']),
    'meta/0000_snapshot.json': legacySnapshotJson('id0', ZERO, {}),
  });
  try {
    const set = readMigrationSet(dir);
    assert.ok(set.diagnostics.some((d) => d.code === 'unreadable-file'));
    assert.equal(set.migrations[0]!.sql, '');
  } finally {
    cleanup();
  }
});

test('legacy: broken snapshot chain → diagnostic and prevSnapshot dropped', () => {
  const { dir, cleanup } = tempTree({
    'meta/_journal.json': journalJson('postgresql', ['0000_init', '0001_evolve']),
    '0000_init.sql': 'SELECT 1;',
    '0001_evolve.sql': 'SELECT 2;',
    'meta/0000_snapshot.json': legacySnapshotJson('id0', ZERO, {}),
    // prevId points at the wrong ancestor
    'meta/0001_snapshot.json': legacySnapshotJson('id1', 'WRONG', {}),
  });
  try {
    const set = readMigrationSet(dir);
    assert.ok(set.diagnostics.some((d) => d.code === 'snapshot-chain-broken'));
    assert.equal(set.migrations[1]!.prevSnapshot, null);
  } finally {
    cleanup();
  }
});

test('legacy: a later migration whose predecessor lost its snapshot gets a null prevSnapshot', () => {
  const { dir, cleanup } = tempTree({
    'meta/_journal.json': journalJson('postgresql', ['0000_init', '0001_evolve']),
    '0000_init.sql': 'SELECT 1;',
    '0001_evolve.sql': 'SELECT 2;',
    // 0000 snapshot deliberately absent
    'meta/0001_snapshot.json': legacySnapshotJson('id1', 'id0', {}),
  });
  try {
    const set = readMigrationSet(dir);
    assert.equal(set.migrations[0]!.snapshot, null);
    assert.equal(set.migrations[1]!.prevSnapshot, null);
    assert.ok(set.diagnostics.some((d) => d.code === 'missing-snapshot'));
  } finally {
    cleanup();
  }
});

test('legacy: unparseable journal throws UsageError', () => {
  const { dir, cleanup } = tempTree({ 'meta/_journal.json': '{ not json' });
  try {
    assert.throws(() => readMigrationSet(dir), /cannot parse/);
  } finally {
    cleanup();
  }
});

test('legacy: journal missing entries array throws UsageError', () => {
  const { dir, cleanup } = tempTree({ 'meta/_journal.json': JSON.stringify({ dialect: 'postgresql' }) });
  try {
    assert.throws(() => readMigrationSet(dir), /does not look like a drizzle-kit journal/);
  } finally {
    cleanup();
  }
});

test('legacy: unknown journal dialect throws UsageError', () => {
  const { dir, cleanup } = tempTree({
    'meta/_journal.json': JSON.stringify({ dialect: 'oracle', entries: [] }),
  });
  try {
    assert.throws(() => readMigrationSet(dir), /unknown dialect/);
  } finally {
    cleanup();
  }
});

test('legacy: malformed entries are filtered out', () => {
  const { dir, cleanup } = tempTree({
    'meta/_journal.json': JSON.stringify({
      dialect: 'sqlite',
      entries: [{ idx: 0, tag: '0000_init' }, { idx: 1 }, 'junk'],
    }),
    '0000_init.sql': 'SELECT 1;',
    'meta/0000_snapshot.json': legacySnapshotJson('id0', ZERO, {}),
  });
  try {
    const set = readMigrationSet(dir);
    assert.equal(set.migrations.length, 1);
  } finally {
    cleanup();
  }
});

// ---------- v1 reader ----------

test('v1: reads folders in timestamp order and resolves the DAG predecessor', () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'CREATE TABLE "users" ("id" serial);',
    '20240101000000_init/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users']),
    '20240102000000_evolve/migration.sql': 'ALTER TABLE "users" ADD COLUMN "email" text;',
    '20240102000000_evolve/snapshot.json': v1SnapshotJson('id1', ['id0'], ['users', 'audit']),
  });
  try {
    const set = readMigrationSet(dir);
    assert.equal(set.format, 'v1');
    assert.equal(set.dialect, 'postgresql');
    assert.deepEqual(set.migrations.map((m) => m.id), ['20240101000000_init', '20240102000000_evolve']);
    assert.equal(set.migrations[0]!.isFirst, true);
    assert.equal(set.migrations[1]!.prevSnapshot?.id, 'id0');
  } finally {
    cleanup();
  }
});

test('v1: sqlite dialect literal is read from the snapshot', () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'CREATE TABLE `users` (`id` integer);',
    '20240101000000_init/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users'], 'sqlite'),
  });
  try {
    assert.equal(readMigrationSet(dir).dialect, 'sqlite');
  } finally {
    cleanup();
  }
});

test('v1: merge commit (two parents) → prevSnapshot is the union of parent tables', () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_a/migration.sql': 'SELECT 1;',
    '20240101000000_a/snapshot.json': v1SnapshotJson('ida', [ZERO], ['users']),
    '20240102000000_b/migration.sql': 'SELECT 2;',
    '20240102000000_b/snapshot.json': v1SnapshotJson('idb', [ZERO], ['posts']),
    '20240103000000_merge/migration.sql': 'SELECT 3;',
    '20240103000000_merge/snapshot.json': v1SnapshotJson('idm', ['ida', 'idb'], ['users', 'posts', 'audit']),
  });
  try {
    const set = readMigrationSet(dir);
    const merge = set.migrations.find((m) => m.id.endsWith('_merge'))!;
    assert.deepEqual([...merge.prevSnapshot!.tables].sort(), ['posts', 'users']);
  } finally {
    cleanup();
  }
});

test('v1: multiple heads → parallel-branches diagnostic', () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_base/migration.sql': 'SELECT 1;',
    '20240101000000_base/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users']),
    '20240102000000_a/migration.sql': 'SELECT 2;',
    '20240102000000_a/snapshot.json': v1SnapshotJson('ida', ['id0'], ['users']),
    '20240102000001_b/migration.sql': 'SELECT 3;',
    '20240102000001_b/snapshot.json': v1SnapshotJson('idb', ['id0'], ['users']),
  });
  try {
    const set = readMigrationSet(dir);
    const diag = set.diagnostics.find((d) => d.code === 'parallel-branches');
    assert.ok(diag);
    assert.match(diag!.message, /2 heads/);
  } finally {
    cleanup();
  }
});

test('v1: prevId pointing nowhere → chain-broken diagnostic and prevSnapshot dropped', () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'SELECT 1;',
    '20240101000000_init/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users']),
    '20240102000000_evolve/migration.sql': 'SELECT 2;',
    '20240102000000_evolve/snapshot.json': v1SnapshotJson('id1', ['GHOST'], ['users']),
  });
  try {
    const set = readMigrationSet(dir);
    assert.ok(set.diagnostics.some((d) => d.code === 'snapshot-chain-broken'));
    assert.equal(set.migrations[1]!.prevSnapshot, null);
  } finally {
    cleanup();
  }
});

test('v1: missing snapshot.json → missing-snapshot diagnostic, SQL still linted', () => {
  const { dir, cleanup } = tempTree({ '20240101000000_init/migration.sql': 'TRUNCATE "users";' });
  try {
    const set = readMigrationSet(dir, { dialect: 'postgresql' });
    assert.ok(set.diagnostics.some((d) => d.code === 'missing-snapshot'));
    assert.equal(set.migrations[0]!.snapshot, null);
    assert.equal(set.migrations[0]!.isFirst, false);
  } finally {
    cleanup();
  }
});

test('v1: unrecognized snapshot shape → unknown-snapshot-version diagnostic', () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'SELECT 1;',
    '20240101000000_init/snapshot.json': JSON.stringify({ garbage: true }),
  });
  try {
    const set = readMigrationSet(dir, { dialect: 'postgresql' });
    assert.ok(set.diagnostics.some((d) => d.code === 'unknown-snapshot-version'));
  } finally {
    cleanup();
  }
});

test('v1: a folder missing migration.sql → unreadable-file diagnostic', () => {
  // The detector needs one valid folder to classify the dir as v1; the
  // reader then processes every timestamp folder, so the SQL-less one is
  // reported rather than silently skipped.
  const { dir, cleanup } = tempTree({
    '20240101000000_broken/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users']),
    '20240102000000_ok/migration.sql': 'SELECT 1;',
    '20240102000000_ok/snapshot.json': v1SnapshotJson('id1', [ZERO], ['users']),
  });
  try {
    const set = readMigrationSet(dir);
    assert.ok(set.diagnostics.some((d) => d.code === 'unreadable-file'));
  } finally {
    cleanup();
  }
});

test('v1: no dialect anywhere and no override throws UsageError', () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'SELECT 1;',
    '20240101000000_init/snapshot.json': JSON.stringify({ id: 'x', ddl: [], prevIds: [ZERO] }),
  });
  try {
    assert.throws(() => readMigrationSet(dir), /cannot determine the dialect/);
  } finally {
    cleanup();
  }
});
