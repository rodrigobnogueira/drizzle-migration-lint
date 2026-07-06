import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ZERO_SNAPSHOT_ID,
  normalizeDialect,
  normalizeLegacySnapshot,
  normalizeV1Snapshot,
  v1SnapshotDialect,
} from '../../src/snapshot';

test('normalizeDialect maps every artifact literal, including the v1 rename', () => {
  assert.equal(normalizeDialect('postgresql'), 'postgresql');
  assert.equal(normalizeDialect('postgres'), 'postgresql');
  assert.equal(normalizeDialect('sqlite'), 'sqlite');
  assert.equal(normalizeDialect('turso'), 'turso');
  assert.equal(normalizeDialect('made-up'), null);
  assert.equal(normalizeDialect(7), null);
});

test('legacy pg v7: identity comes from value schema+name, never record keys', () => {
  const snapshot = normalizeLegacySnapshot({
    id: 'a',
    prevId: ZERO_SNAPSHOT_ID,
    tables: {
      // observed drizzle-kit 0.31.10 output: key "public.users", schema ""
      'public.users': { name: 'users', schema: '' },
      'auth.sessions': { name: 'sessions', schema: 'auth' },
    },
  });
  assert.ok(snapshot);
  assert.deepEqual([...snapshot.tables].sort(), ['auth.sessions', 'users']);
  assert.deepEqual(snapshot.prevIds, []); // zero sentinel filtered
});

test('legacy sqlite v6: bare keys, no schema field', () => {
  const snapshot = normalizeLegacySnapshot({
    id: 'b',
    prevId: 'a',
    tables: { users: { name: 'users' } },
  });
  assert.ok(snapshot);
  assert.deepEqual([...snapshot.tables], ['users']);
  assert.deepEqual(snapshot.prevIds, ['a']);
});

test('legacy snapshot tolerates malformed shapes', () => {
  assert.equal(normalizeLegacySnapshot(null), null);
  assert.equal(normalizeLegacySnapshot('nope'), null);
  assert.equal(normalizeLegacySnapshot({ tables: {} }), null); // no id
  const noTables = normalizeLegacySnapshot({ id: 'x' });
  assert.ok(noTables);
  assert.equal(noTables.tables.size, 0);
  const junkValues = normalizeLegacySnapshot({ id: 'x', tables: { a: 'junk', b: { noName: true } } });
  assert.ok(junkValues);
  assert.equal(junkValues.tables.size, 0);
  const noPrev = normalizeLegacySnapshot({ id: 'x', prevId: 42 });
  assert.ok(noPrev);
  assert.deepEqual(noPrev.prevIds, []);
});

test('v1 pg v8: tables come from ddl entities with entityType "tables"', () => {
  const snapshot = normalizeV1Snapshot({
    version: '8',
    dialect: 'postgres',
    id: 'c',
    prevIds: [ZERO_SNAPSHOT_ID],
    ddl: [
      { entityType: 'tables', name: 'users', schema: 'public' },
      { entityType: 'tables', name: 'sessions', schema: 'auth' },
      { entityType: 'columns', name: 'id', schema: 'public', table: 'users' },
      'junk',
      { entityType: 'tables', name: 42 },
    ],
    renames: [],
  });
  assert.ok(snapshot);
  assert.deepEqual([...snapshot.tables].sort(), ['auth.sessions', 'users']);
  assert.deepEqual(snapshot.prevIds, []);
});

test('v1 sqlite v7: table entities carry no schema field', () => {
  const snapshot = normalizeV1Snapshot({
    version: '7',
    dialect: 'sqlite',
    id: 'd',
    prevIds: ['c', 7],
    ddl: [{ entityType: 'tables', name: 'users' }],
  });
  assert.ok(snapshot);
  assert.deepEqual([...snapshot.tables], ['users']);
  assert.deepEqual(snapshot.prevIds, ['c']); // non-string prevIds dropped
});

test('v1 snapshot tolerates malformed shapes', () => {
  assert.equal(normalizeV1Snapshot(null), null);
  assert.equal(normalizeV1Snapshot({ id: 'x' }), null); // no ddl array
  assert.equal(normalizeV1Snapshot({ ddl: [] }), null); // no id
  const noPrev = normalizeV1Snapshot({ id: 'x', ddl: [] });
  assert.ok(noPrev);
  assert.deepEqual(noPrev.prevIds, []);
});

test('v1SnapshotDialect reads and normalizes the dialect literal', () => {
  assert.equal(v1SnapshotDialect({ dialect: 'postgres' }), 'postgresql');
  assert.equal(v1SnapshotDialect({ dialect: 'nope' }), null);
  assert.equal(v1SnapshotDialect(null), null);
});
