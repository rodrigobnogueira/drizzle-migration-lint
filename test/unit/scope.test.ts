import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveScope } from '../../src/scope';
import type { ArtifactFormat, Migration, MigrationSet } from '../../src/types';

function migration(id: string): Migration {
  return {
    id, index: 0, sqlPath: `${id}.sql`, sql: '', statements: [],
    snapshot: null, prevSnapshot: null, isFirst: false,
  };
}

function makeSet(dir: string, format: ArtifactFormat, ids: string[]): MigrationSet {
  return { format, dialect: 'postgresql', dir, migrations: ids.map(migration), diagnostics: [] };
}

// ---------- baseline & --all (no git) ----------

test('--all puts every migration in scope', () => {
  const set = makeSet('/x', 'v1', ['a', 'b', 'c']);
  const scope = resolveScope(set, { all: true });
  assert.ok(['a', 'b', 'c'].every((id) => scope.inScope(id)));
  assert.equal(scope.diagnostics.length, 0);
});

test('baseline scopes to migrations after the baseline id', () => {
  const set = makeSet('/x', 'v1', ['a', 'b', 'c']);
  const scope = resolveScope(set, { baseline: { tag: 'b' } });
  assert.deepEqual(['a', 'b', 'c'].map(scope.inScope), [false, false, true]);
});

test('a baseline id no longer present fails safe (stale + lint all)', () => {
  const set = makeSet('/x', 'v1', ['a', 'b']);
  const scope = resolveScope(set, { baseline: { tag: 'gone' } });
  assert.ok(scope.inScope('a') && scope.inScope('b'));
  assert.equal(scope.diagnostics[0]!.code, 'baseline-stale');
});

test('no options → everything in scope', () => {
  const scope = resolveScope(makeSet('/x', 'v1', ['a']), {});
  assert.ok(scope.inScope('a'));
});

// ---------- --since with a real git repo ----------

interface Repo {
  root: string;
  run: (...args: string[]) => void;
  cleanup: () => void;
}

function gitRepo(): Repo {
  const root = mkdtempSync(join(tmpdir(), 'dml-git-'));
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('config', 'commit.gpgsign', 'false');
  return { root, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeV1Folder(dir: string, name: string): void {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'migration.sql'), 'SELECT 1;');
  writeFileSync(join(dir, name, 'snapshot.json'), '{}');
}

test('--since lints only migrations added after the ref (v1)', () => {
  const repo = gitRepo();
  try {
    const dir = join(repo.root, 'drizzle');
    writeV1Folder(dir, '20240101000000_a');
    repo.run('add', '-A');
    repo.run('commit', '-q', '-m', 'first');
    writeV1Folder(dir, '20240102000000_b');
    repo.run('add', '-A');
    repo.run('commit', '-q', '-m', 'second');

    const set = makeSet(dir, 'v1', ['20240101000000_a', '20240102000000_b']);
    const scope = resolveScope(set, { since: 'HEAD~1' });
    assert.equal(scope.inScope('20240101000000_a'), false); // existed at HEAD~1
    assert.equal(scope.inScope('20240102000000_b'), true); // new since
    assert.equal(scope.diagnostics.length, 0);
  } finally {
    repo.cleanup();
  }
});

test('--since reads the legacy journal at the ref', () => {
  const repo = gitRepo();
  try {
    const dir = join(repo.root, 'drizzle');
    mkdirSync(join(dir, 'meta'), { recursive: true });
    const journal = (tags: string[]) =>
      JSON.stringify({ version: '7', dialect: 'postgresql', entries: tags.map((tag, idx) => ({ idx, version: '7', when: idx, tag, breakpoints: true })) });
    writeFileSync(join(dir, 'meta', '_journal.json'), journal(['0000_a']));
    repo.run('add', '-A');
    repo.run('commit', '-q', '-m', 'first');
    writeFileSync(join(dir, 'meta', '_journal.json'), journal(['0000_a', '0001_b']));
    repo.run('add', '-A');
    repo.run('commit', '-q', '-m', 'second');

    const set = makeSet(dir, 'legacy', ['0000_a', '0001_b']);
    const scope = resolveScope(set, { since: 'HEAD~1' });
    assert.deepEqual(['0000_a', '0001_b'].map(scope.inScope), [false, true]);
  } finally {
    repo.cleanup();
  }
});

test('--since (legacy) fails safe when the journal is absent at the ref', () => {
  const repo = gitRepo();
  try {
    const dir = join(repo.root, 'drizzle');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'readme.txt'), 'x'); // committed, but no meta/_journal.json
    repo.run('add', '-A');
    repo.run('commit', '-q', '-m', 'first');
    const set = makeSet(dir, 'legacy', ['0000_a']);
    const scope = resolveScope(set, { since: 'HEAD' });
    assert.equal(scope.diagnostics[0]!.code, 'baseline-stale');
  } finally {
    repo.cleanup();
  }
});

test('--since (legacy) fails safe when the journal at the ref is malformed', () => {
  const repo = gitRepo();
  try {
    const dir = join(repo.root, 'drizzle');
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(join(dir, 'meta', '_journal.json'), '{ not json');
    repo.run('add', '-A');
    repo.run('commit', '-q', '-m', 'first');
    const set = makeSet(dir, 'legacy', ['0000_a']);
    const scope = resolveScope(set, { since: 'HEAD' });
    assert.equal(scope.diagnostics[0]!.code, 'baseline-stale');
  } finally {
    repo.cleanup();
  }
});

test('--since (legacy) treats a journal with no entries as an empty past', () => {
  const repo = gitRepo();
  try {
    const dir = join(repo.root, 'drizzle');
    mkdirSync(join(dir, 'meta'), { recursive: true });
    writeFileSync(join(dir, 'meta', '_journal.json'), '{}'); // valid JSON, no entries key
    repo.run('add', '-A');
    repo.run('commit', '-q', '-m', 'first');
    const set = makeSet(dir, 'legacy', ['0000_a']);
    const scope = resolveScope(set, { since: 'HEAD' });
    assert.ok(scope.inScope('0000_a')); // nothing existed at the ref → all in scope
    assert.equal(scope.diagnostics.length, 0);
  } finally {
    repo.cleanup();
  }
});

test('--since fails safe when the ref cannot be resolved', () => {
  const repo = gitRepo();
  try {
    const dir = join(repo.root, 'drizzle');
    writeV1Folder(dir, '20240101000000_a');
    repo.run('add', '-A');
    repo.run('commit', '-q', '-m', 'first');
    const set = makeSet(dir, 'v1', ['20240101000000_a']);
    const scope = resolveScope(set, { since: 'no-such-ref' });
    assert.ok(scope.inScope('20240101000000_a'));
    assert.equal(scope.diagnostics[0]!.code, 'baseline-stale');
  } finally {
    repo.cleanup();
  }
});

test('--since outside a git repo fails safe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dml-nogit-'));
  try {
    const set = makeSet(dir, 'v1', ['20240101000000_a']);
    const scope = resolveScope(set, { since: 'HEAD' });
    assert.equal(scope.diagnostics[0]!.code, 'baseline-stale');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--since flags a rewritten history (a past migration is gone now)', () => {
  const repo = gitRepo();
  try {
    const dir = join(repo.root, 'drizzle');
    writeV1Folder(dir, '20240101000000_a');
    writeV1Folder(dir, '20240102000000_b');
    repo.run('add', '-A');
    repo.run('commit', '-q', '-m', 'first');
    // current on-disk set dropped "_b" → past is not a subset of current
    const set = makeSet(dir, 'v1', ['20240101000000_a']);
    const scope = resolveScope(set, { since: 'HEAD' });
    assert.ok(scope.inScope('20240101000000_a'));
    assert.equal(scope.diagnostics[0]!.code, 'baseline-stale');
  } finally {
    repo.cleanup();
  }
});
