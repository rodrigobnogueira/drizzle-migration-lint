import assert from 'node:assert/strict';
import { test } from 'node:test';
import { introspectTableSizes, type PgClientLike, type SizeRow } from '../../src/introspect';

function fakeClient(over: Partial<PgClientLike> & { rows?: SizeRow[] } = {}): {
  client: PgClientLike;
  ended: () => boolean;
} {
  let ended = false;
  const client: PgClientLike = {
    query: over.query ?? (async () => ({ rows: over.rows ?? [] })),
    end:
      over.end ??
      (async () => {
        ended = true;
      }),
  };
  return { client, ended: () => ended };
}

test('reads sizes into a normalized map (public → bare, else schema.table)', async () => {
  const { client, ended } = fakeClient({
    rows: [
      { schema: 'public', name: 'users', bytes: '2048' },
      { schema: 'auth', name: 'sessions', bytes: 4096 },
    ],
  });
  const result = await introspectTableSizes('postgres://x', async () => client);
  assert.ok('sizes' in result);
  assert.equal(result.sizes.get('users'), 2048);
  assert.equal(result.sizes.get('auth.sessions'), 4096);
  assert.equal(ended(), true, 'the connection is closed');
});

test('a query failure degrades to an error result', async () => {
  const { client } = fakeClient({
    query: async () => {
      throw new Error('permission denied for pg_class');
    },
  });
  const result = await introspectTableSizes('postgres://x', async () => client);
  assert.ok('error' in result);
  assert.match(result.error, /permission denied/);
});

test('a connection failure degrades to an error result (no client to close)', async () => {
  const result = await introspectTableSizes('postgres://x', async () => {
    throw new Error('ECONNREFUSED');
  });
  assert.ok('error' in result);
  assert.match(result.error, /ECONNREFUSED/);
});

test('errors while closing the connection are swallowed', async () => {
  const { client } = fakeClient({
    rows: [{ schema: 'public', name: 'users', bytes: '1' }],
    end: async () => {
      throw new Error('already closed');
    },
  });
  const result = await introspectTableSizes('postgres://x', async () => client);
  assert.ok('sizes' in result); // the close error does not clobber the result
  assert.equal(result.sizes.get('users'), 1);
});
