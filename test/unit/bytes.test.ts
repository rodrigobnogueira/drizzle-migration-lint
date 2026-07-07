import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBytes, parseSize } from '../../src/bytes';
import { UsageError } from '../../src/errors';

test('formatBytes scales through the units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KiB');
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatBytes(16 * 1024 * 1024), '16 MiB');
  assert.equal(formatBytes(2 * 1024 ** 3), '2 GiB');
  // caps at the largest unit
  assert.equal(formatBytes(5 * 1024 ** 4), '5 TiB');
  assert.equal(formatBytes(1024 ** 5), '1024 TiB');
});

test('parseSize accepts raw bytes and 1024-based suffixes', () => {
  assert.equal(parseSize('10485760'), 10485760);
  assert.equal(parseSize('16MB'), 16 * 1024 * 1024);
  assert.equal(parseSize('1gb'), 1024 ** 3);
  assert.equal(parseSize('2TB'), 2 * 1024 ** 4);
  assert.equal(parseSize('512kb'), 512 * 1024);
  assert.equal(parseSize('1.5MB'), Math.round(1.5 * 1024 * 1024));
  assert.equal(parseSize('  4 KB '), 4 * 1024);
  assert.equal(parseSize('100b'), 100);
});

test('parseSize rejects malformed values', () => {
  assert.throws(() => parseSize('abc'), UsageError);
  assert.throws(() => parseSize(''), UsageError);
  assert.throws(() => parseSize('16 zz'), UsageError);
  assert.throws(() => parseSize('MB'), UsageError);
});
