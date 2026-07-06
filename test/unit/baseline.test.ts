import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { runBaseline } from '../../src/baseline';
import { UsageError } from '../../src/errors';
import type { Migration, MigrationSet } from '../../src/types';
import { tempTree } from '../support/tmp';

function migration(id: string): Migration {
  return { id, index: 0, sqlPath: `${id}.sql`, sql: '', statements: [], snapshot: null, prevSnapshot: null, isFirst: false };
}

function makeSet(ids: string[]): MigrationSet {
  return { format: 'v1', dialect: 'postgresql', dir: '/x', migrations: ids.map(migration), diagnostics: [] };
}

test('baseline records the latest migration id, preserving other config keys', () => {
  const { dir, cleanup } = tempTree({
    '.drizzle-migration-lint.json': JSON.stringify({ dir: './m', rules: { 'drop-table': 'off' } }),
  });
  try {
    const writes: { path: string; data: string }[] = [];
    const result = runBaseline(dir, makeSet(['a', 'b', 'c']), undefined, (path, data) => writes.push({ path, data }));
    assert.equal(result.tag, 'c');
    const written = JSON.parse(writes[0]!.data);
    assert.deepEqual(written.baseline, { tag: 'c' });
    assert.equal(written.dir, './m'); // preserved
    assert.equal(written.rules['drop-table'], 'off'); // preserved
  } finally {
    cleanup();
  }
});

test('baseline writes a fresh config when none exists', () => {
  const { dir, cleanup } = tempTree({ 'x.txt': '' });
  try {
    let captured = '';
    runBaseline(dir, makeSet(['only']), undefined, (_path, data) => {
      captured = data;
    });
    assert.deepEqual(JSON.parse(captured), { baseline: { tag: 'only' } });
  } finally {
    cleanup();
  }
});

test('baseline honors an explicit --config path', () => {
  const { dir, cleanup } = tempTree({ 'x.txt': '' });
  try {
    let writtenPath = '';
    runBaseline(dir, makeSet(['only']), 'custom/cfg.json', (path) => {
      writtenPath = path;
    });
    assert.equal(writtenPath, join(dir, 'custom/cfg.json'));
  } finally {
    cleanup();
  }
});

test('baseline on an empty history is a usage error', () => {
  assert.throws(() => runBaseline('/x', makeSet([]), undefined, () => {}), UsageError);
});
