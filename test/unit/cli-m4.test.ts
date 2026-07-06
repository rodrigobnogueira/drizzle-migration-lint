import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli, type CliIo } from '../../src/cli';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../../src/exit-code';
import { ZERO, tempTree, v1SnapshotJson } from '../support/tmp';

function capture(cwd: string, env: NodeJS.ProcessEnv = {}): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t), cwd, env }, out, err };
}

/** A two-migration pg project: init creates users, evolve truncates it. */
function project(extra: Record<string, string> = {}) {
  return tempTree({
    'drizzle/20240101000000_init/migration.sql': 'CREATE TABLE "users" ("id" serial);',
    'drizzle/20240101000000_init/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users']),
    'drizzle/20240102000000_wipe/migration.sql': 'TRUNCATE "users";',
    'drizzle/20240102000000_wipe/snapshot.json': v1SnapshotJson('id1', ['id0'], ['users']),
    ...extra,
  });
}

test('the github format emits workflow-command annotations', async () => {
  const { dir, cleanup } = project();
  try {
    const { io, out } = capture(dir);
    await runCli(['check', '--dir', join(dir, 'drizzle'), '--format', 'github', '--fail-on', 'warn'], io);
    assert.match(out.join('\n'), /^::warning file=.*truncate-in-migration/m);
  } finally {
    cleanup();
  }
});

test('under $GITHUB_ACTIONS the default format becomes github', async () => {
  const { dir, cleanup } = project();
  try {
    const { io, out } = capture(dir, { GITHUB_ACTIONS: 'true' });
    await runCli(['check', '--dir', join(dir, 'drizzle')], io);
    assert.match(out.join('\n'), /^::warning /m);
  } finally {
    cleanup();
  }
});

test('a config file can turn a rule off', async () => {
  const { dir, cleanup } = project({
    '.drizzle-migration-lint.json': JSON.stringify({ dir: './drizzle', rules: { 'truncate-in-migration': 'off' } }),
  });
  try {
    const { io, out } = capture(dir);
    // no --dir: dir comes from the config; the off rule leaves it clean
    const code = await runCli(['check', '--format', 'json', '--fail-on', 'warn'], io);
    assert.equal(code, EXIT_CLEAN);
    assert.equal(JSON.parse(out.join('')).findings.length, 0);
  } finally {
    cleanup();
  }
});

test('the baseline command writes the latest migration and later runs skip it', async () => {
  const { dir, cleanup } = project();
  try {
    const drizzleDir = join(dir, 'drizzle');
    const baseline = capture(dir);
    assert.equal(await runCli(['baseline', '--dir', drizzleDir], baseline.io), EXIT_CLEAN);
    assert.match(baseline.out.join(''), /baseline set to "20240102000000_wipe"/);

    const written = JSON.parse(readFileSync(join(dir, '.drizzle-migration-lint.json'), 'utf8'));
    assert.deepEqual(written.baseline, { tag: '20240102000000_wipe' });

    // now the truncate (the baselined migration) is out of scope → clean
    const recheck = capture(dir, {});
    const code = await runCli(['check', '--dir', drizzleDir, '--fail-on', 'warn'], recheck.io);
    assert.equal(code, EXIT_CLEAN);

    // ...unless --all overrides the baseline
    const all = capture(dir);
    assert.equal(await runCli(['check', '--dir', drizzleDir, '--all', '--fail-on', 'warn'], all.io), EXIT_FINDINGS);
  } finally {
    cleanup();
  }
});

test('an explicit --config that is missing is a usage error', async () => {
  const { dir, cleanup } = project();
  try {
    const { io, err } = capture(dir);
    const code = await runCli(['check', '--config', 'nope.json'], io);
    assert.equal(code, 2);
    assert.match(err.join(''), /config file not found/);
  } finally {
    cleanup();
  }
});
