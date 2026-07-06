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
  assert.deepEqual([...snapshot.tables.keys()].sort(), ['auth.sessions', 'users']);
  assert.deepEqual(snapshot.prevIds, []); // zero sentinel filtered
});

test('legacy sqlite v6: bare keys, no schema field', () => {
  const snapshot = normalizeLegacySnapshot({
    id: 'b',
    prevId: 'a',
    tables: { users: { name: 'users' } },
  });
  assert.ok(snapshot);
  assert.deepEqual([...snapshot.tables.keys()], ['users']);
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
  assert.deepEqual([...snapshot.tables.keys()].sort(), ['auth.sessions', 'users']);
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
  assert.deepEqual([...snapshot.tables.keys()], ['users']);
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

// ---------- column extraction ----------

test('legacy tables carry their columns with notNull flags', () => {
  const snapshot = normalizeLegacySnapshot({
    id: 'x',
    tables: {
      'public.users': {
        name: 'users',
        schema: '',
        columns: {
          id: { name: 'id', notNull: true },
          email: { name: 'email', notNull: false },
          bad: { notNull: true },
        },
      },
    },
  });
  const users = snapshot!.tables.get('users')!;
  assert.deepEqual([...users.columns.keys()].sort(), ['email', 'id']);
  assert.equal(users.columns.get('id')!.notNull, true);
  assert.equal(users.columns.get('email')!.notNull, false);
});

test('v1 column entities are attached to their table; orphans are ignored', () => {
  const snapshot = normalizeV1Snapshot({
    id: 'x',
    dialect: 'postgres',
    prevIds: [ZERO_SNAPSHOT_ID],
    ddl: [
      { entityType: 'tables', name: 'users', schema: 'public' },
      { entityType: 'columns', name: 'id', schema: 'public', table: 'users', notNull: true },
      { entityType: 'columns', name: 'ghost', schema: 'public', table: 'missing', notNull: false },
    ],
  });
  const users = snapshot!.tables.get('users')!;
  assert.deepEqual([...users.columns.keys()], ['id']);
  assert.equal(users.columns.get('id')!.notNull, true);
});

// ---------- v1 rename hints (string "from->to") ----------

function v1Renames(renames: unknown[], ddl: unknown[] = [{ entityType: 'tables', name: 'accounts', schema: 'public' }]) {
  return normalizeV1Snapshot({ id: 'x', dialect: 'postgres', prevIds: [ZERO_SNAPSHOT_ID], ddl, renames })!.renames;
}

test('v1 table rename hint (schema-qualified)', () => {
  assert.deepEqual(v1Renames(['public.users->public.accounts']).tables, [
    { from: 'users', to: 'accounts' },
  ]);
});

test('v1 table rename hint (sqlite, bare names)', () => {
  const renames = normalizeV1Snapshot({
    id: 'x',
    dialect: 'sqlite',
    prevIds: [ZERO_SNAPSHOT_ID],
    ddl: [{ entityType: 'tables', name: 'accounts' }],
    renames: ['users->accounts'],
  })!.renames;
  assert.deepEqual(renames.tables, [{ from: 'users', to: 'accounts' }]);
});

test('v1 column rename hint is told apart by its parent table existing', () => {
  const renames = v1Renames(
    ['public.users.full_name->public.users.display_name'],
    [
      { entityType: 'tables', name: 'users', schema: 'public' },
      { entityType: 'columns', name: 'display_name', schema: 'public', table: 'users', notNull: false },
    ],
  );
  assert.deepEqual(renames.columns, [{ table: 'users', from: 'full_name', to: 'display_name' }]);
  assert.deepEqual(renames.tables, []);
});

test('v1 rename hints skip non-strings and entries without an arrow', () => {
  const renames = v1Renames([42, 'no-arrow-here', 'a->b']);
  assert.deepEqual(renames.tables, [{ from: 'a', to: 'b' }]);
  assert.deepEqual(renames.columns, []);
});

test('v1 empty renames array yields no hints', () => {
  assert.deepEqual(v1Renames([]), { tables: [], columns: [] });
});

// ---------- legacy _meta rename hints (defensive; empty in practice) ----------

test('legacy _meta rename hints are parsed (real quoted-identifier keys)', () => {
  // observed drizzle-kit 0.31.10 sqlite _meta: keys/values are quoted SQL idents
  const snapshot = normalizeLegacySnapshot({
    id: 'x',
    tables: {},
    _meta: {
      tables: { '"users"': '"accounts"', bad: 7 },
      columns: { '"users"."full_name"': '"users"."display_name"' },
    },
  });
  assert.deepEqual(snapshot!.renames.tables, [{ from: 'users', to: 'accounts' }]);
  assert.deepEqual(snapshot!.renames.columns, [
    { table: 'users', from: 'full_name', to: 'display_name' },
  ]);
});

test('legacy without _meta yields no rename hints', () => {
  const snapshot = normalizeLegacySnapshot({ id: 'x', tables: {} });
  assert.deepEqual(snapshot!.renames, { tables: [], columns: [] });
});

test('legacy _meta column key without a dot degrades gracefully', () => {
  const snapshot = normalizeLegacySnapshot({
    id: 'x',
    tables: {},
    _meta: { columns: { loose: 'renamed' } },
  });
  assert.deepEqual(snapshot!.renames.columns, [{ table: '', from: 'loose', to: 'renamed' }]);
});
