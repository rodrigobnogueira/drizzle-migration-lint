import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCli, type CliIo } from '../../src/cli';
import { EXIT_CLEAN, EXIT_FINDINGS, EXIT_USAGE } from '../../src/exit-code';
import { ZERO, tempTree, v1SnapshotJson } from '../support/tmp';

function capture(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = {},
): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t), cwd, env }, out, err };
}

test('--help prints usage and exits clean', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['--help'], io), EXIT_CLEAN);
  assert.match(out.join('\n'), /Usage:/);
});

test('-h is the short form of help', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['-h'], io), EXIT_CLEAN);
  assert.match(out.join('\n'), /Usage:/);
});

test('--version prints the package version', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['--version'], io), EXIT_CLEAN);
  assert.match(out.join(''), /^\d+\.\d+\.\d+/);
});

test('-v is the short form of version', async () => {
  const { io, out } = capture();
  assert.equal(await runCli(['-v'], io), EXIT_CLEAN);
  assert.match(out.join(''), /^\d+\.\d+\.\d+/);
});

test('unknown option → usage error with help text', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['--nonsense'], io), EXIT_USAGE);
  assert.match(err.join('\n'), /Usage:/);
});

test('unknown command → usage error', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['explode'], io), EXIT_USAGE);
  assert.match(err.join('\n'), /unknown command/);
});

test('extra positionals → usage error', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['check', 'extra'], io), EXIT_USAGE);
  assert.match(err.join('\n'), /unknown command/);
});

test('bad --format → usage error', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['--format', 'yaml'], io), EXIT_USAGE);
  assert.match(err.join('\n'), /unknown --format/);
});

test('bad --fail-on → usage error', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['--fail-on', 'sometimes'], io), EXIT_USAGE);
  assert.match(err.join('\n'), /unknown --fail-on/);
});

test('bad --dialect → usage error', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['--dir', '/x', '--dialect', 'oracle'], io), EXIT_USAGE);
  assert.match(err.join('\n'), /unknown --dialect/);
});

test('nonexistent directory → usage error (exit 2)', async () => {
  const { io, err } = capture();
  assert.equal(await runCli(['check', '--dir', '/no/such/place'], io), EXIT_USAGE);
  assert.match(err.join('\n'), /cannot read migrations directory/);
});

test('clean fixture with default command and pretty format → exit 0', async () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'CREATE TABLE "users" ("id" serial);',
    '20240101000000_init/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users']),
  });
  try {
    const { io, out } = capture();
    assert.equal(await runCli(['--dir', dir], io), EXIT_CLEAN);
    assert.match(out.join('\n'), /No unsafe operations found\./);
  } finally {
    cleanup();
  }
});

test('json format emits the machine envelope', async () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'CREATE TABLE "users" ("id" serial);',
    '20240101000000_init/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users']),
  });
  try {
    const { io, out } = capture();
    assert.equal(await runCli(['check', '--dir', dir, '--format', 'json'], io), EXIT_CLEAN);
    assert.equal(JSON.parse(out.join('')).version, 1);
  } finally {
    cleanup();
  }
});

test('a truncate on a pre-existing table is reported (warn: exit 0 by default, exit 1 under --fail-on warn)', async () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'CREATE TABLE "users" ("id" serial);',
    '20240101000000_init/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users']),
    '20240102000000_wipe/migration.sql': 'TRUNCATE "users";',
    '20240102000000_wipe/snapshot.json': v1SnapshotJson('id1', ['id0'], ['users']),
  });
  try {
    const { io, out } = capture();
    // the finding is present, but a warning does not fail the default gate
    assert.equal(await runCli(['--dir', dir, '--format', 'json'], io), EXIT_CLEAN);
    const parsed = JSON.parse(out.join(''));
    assert.equal(parsed.findings.length, 1);
    assert.equal(parsed.findings[0].rule, 'truncate-in-migration');

    const strict = capture();
    assert.equal(await runCli(['--dir', dir, '--fail-on', 'warn'], strict.io), EXIT_FINDINGS);
  } finally {
    cleanup();
  }
});

test('--fail-on none downgrades a would-fail warning to a clean exit', async () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'CREATE TABLE "users" ("id" serial);',
    '20240101000000_init/snapshot.json': v1SnapshotJson('id0', [ZERO], ['users']),
    '20240102000000_wipe/migration.sql': 'TRUNCATE "users";',
    '20240102000000_wipe/snapshot.json': v1SnapshotJson('id1', ['id0'], ['users']),
  });
  try {
    assert.equal(await runCli(['--dir', dir, '--fail-on', 'warn'], capture().io), EXIT_FINDINGS);
    assert.equal(await runCli(['--dir', dir, '--fail-on', 'none'], capture().io), EXIT_CLEAN);
  } finally {
    cleanup();
  }
});

test('--dialect is honored when snapshots lack one (all snapshots missing)', async () => {
  const { dir, cleanup } = tempTree({
    '20240101000000_init/migration.sql': 'TRUNCATE "users";',
  });
  try {
    const { io, out } = capture();
    // no snapshot → dialect can't be read from artifacts; flag supplies it
    assert.equal(
      await runCli(['--dir', dir, '--dialect', 'postgresql', '--fail-on', 'warn', '--format', 'json'], io),
      EXIT_FINDINGS,
    );
    const parsed = JSON.parse(out.join(''));
    assert.ok(parsed.diagnostics.some((d: { code: string }) => d.code === 'missing-snapshot'));
  } finally {
    cleanup();
  }
});
