import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';

const REPO_ROOT = join(__dirname, '..');
const CLI = join(REPO_ROOT, 'src', 'cli.ts');

/** Drives the real bin entry (require.main === module → process.exitCode) in
 * a child process, through ts-node so no build step is required. */
function runBin(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--require', 'ts-node/register', CLI, ...args],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, TS_NODE_PROJECT: join(REPO_ROOT, 'tsconfig.spec.json'), NO_COLOR: '1' },
    },
  );
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test('e2e: --help exits 0', () => {
  const { status, stdout } = runBin(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /drizzle-migration-lint/);
});

test('e2e: clean bootstrap fixture exits 0 (v1)', () => {
  const { status, stdout } = runBin(['check', '--dir', 'test/fixtures/pg-bootstrap/v1', '--format', 'json']);
  assert.equal(status, 0);
  assert.equal(JSON.parse(stdout).summary.errors, 0);
});

test('e2e: clean bootstrap fixture exits 0 (legacy)', () => {
  const { status } = runBin(['check', '--dir', 'test/fixtures/sqlite-bootstrap/legacy']);
  assert.equal(status, 0);
});

test('e2e: a nonexistent directory exits 2', () => {
  const { status, stderr } = runBin(['check', '--dir', 'no/such/dir']);
  assert.equal(status, 2);
  assert.match(stderr, /cannot read migrations directory/);
});
