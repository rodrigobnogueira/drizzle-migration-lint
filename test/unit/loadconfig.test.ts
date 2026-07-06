import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, resolveLocation } from '../../src/config';
import { UsageError } from '../../src/errors';
import { tempTree } from '../support/tmp';

test('a missing default config yields an empty config', () => {
  const { dir, cleanup } = tempTree({ 'x.txt': '' });
  try {
    const { config, path } = loadConfig(dir);
    assert.deepEqual(config, {});
    assert.equal(path, null);
  } finally {
    cleanup();
  }
});

test('a present default config is read', () => {
  const { dir, cleanup } = tempTree({
    '.drizzle-migration-lint.json': JSON.stringify({ dir: './m', rules: { 'drop-table': 'off' } }),
  });
  try {
    const { config, path } = loadConfig(dir);
    assert.equal(config.dir, './m');
    assert.equal(config.rules?.['drop-table'], 'off');
    assert.equal(path, join(dir, '.drizzle-migration-lint.json'));
  } finally {
    cleanup();
  }
});

test('an explicit --config path is honored and required to exist', () => {
  const { dir, cleanup } = tempTree({ 'custom.json': JSON.stringify({ dialect: 'postgresql' }) });
  try {
    assert.equal(loadConfig(dir, 'custom.json').config.dialect, 'postgresql');
    assert.throws(() => loadConfig(dir, 'missing.json'), /config file not found/);
  } finally {
    cleanup();
  }
});

test('an absolute --config path is used as-is', () => {
  const { dir, cleanup } = tempTree({ 'abs.json': JSON.stringify({ dir: './z' }) });
  try {
    assert.equal(loadConfig(dir, join(dir, 'abs.json')).config.dir, './z');
  } finally {
    cleanup();
  }
});

test('malformed or non-object config is a usage error', () => {
  const bad = tempTree({ '.drizzle-migration-lint.json': '{ not json' });
  try {
    assert.throws(() => loadConfig(bad.dir), UsageError);
  } finally {
    bad.cleanup();
  }
  const arr = tempTree({ '.drizzle-migration-lint.json': '[]' });
  try {
    assert.throws(() => loadConfig(arr.dir), /must contain a JSON object/);
  } finally {
    arr.cleanup();
  }
});

test('resolveLocation: config dir and dialect sit between flags and drizzle.config', () => {
  const fromConfig = resolveLocation('/root', undefined, undefined, { dir: 'cfg/migrations', dialect: 'postgres' });
  assert.equal(fromConfig.dir, join('/root', 'cfg/migrations'));
  assert.equal(fromConfig.dialect, 'postgresql');
  assert.equal(fromConfig.source, 'config');

  // a flag still wins over config
  const fromFlag = resolveLocation('/root', 'flag/dir', undefined, { dir: 'cfg/migrations' });
  assert.equal(fromFlag.source, 'flags');
  assert.equal(fromFlag.dir, join('/root', 'flag/dir'));

  // an absolute config dir is kept
  assert.equal(resolveLocation('/root', undefined, undefined, { dir: '/abs/m' }).dir, '/abs/m');

  // flag dir with a config dialect still surfaces the config dialect
  assert.equal(resolveLocation('/root', 'd', undefined, { dialect: 'mysql' }).dialect, 'mysql');

  // an unrecognized config dialect is dropped to undefined
  assert.equal(resolveLocation('/root', 'd', undefined, { dialect: 'oracle' }).dialect, undefined);
});
