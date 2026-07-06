import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { resolveLocation } from '../../src/config';
import { tempTree } from '../support/tmp';

test('explicit --dir wins and is resolved against cwd', () => {
  const location = resolveLocation('/home/proj', 'src/db/migrations', undefined);
  assert.equal(location.dir, '/home/proj/src/db/migrations');
  assert.equal(location.source, 'flags');
});

test('explicit --dir absolute path is kept as-is', () => {
  const location = resolveLocation('/home/proj', '/abs/migrations', 'postgresql');
  assert.equal(location.dir, '/abs/migrations');
  assert.equal(location.dialect, 'postgresql');
});

test('reads out + dialect from drizzle.config.ts via regex', () => {
  const { dir, cleanup } = tempTree({
    'drizzle.config.ts':
      "import { defineConfig } from 'drizzle-kit';\n" +
      "export default defineConfig({ schema: './s.ts', out: './migrations', dialect: 'postgresql' });\n",
  });
  try {
    const location = resolveLocation(dir, undefined, undefined);
    assert.equal(location.dir, join(dir, 'migrations'));
    assert.equal(location.dialect, 'postgresql');
    assert.equal(location.source, 'drizzle-config');
  } finally {
    cleanup();
  }
});

test('flag dialect overrides config dialect', () => {
  const { dir, cleanup } = tempTree({
    'drizzle.config.js': "module.exports = { out: './m', dialect: 'sqlite' };",
  });
  try {
    const location = resolveLocation(dir, undefined, 'postgresql');
    assert.equal(location.dialect, 'postgresql');
  } finally {
    cleanup();
  }
});

test('config with an unknown dialect literal yields undefined dialect', () => {
  const { dir, cleanup } = tempTree({
    'drizzle.config.mjs': "export default { out: './m', dialect: 'oracle' };",
  });
  try {
    const location = resolveLocation(dir, undefined, undefined);
    assert.equal(location.dialect, undefined);
    assert.equal(location.source, 'drizzle-config');
  } finally {
    cleanup();
  }
});

test('config without out: falls through to ./drizzle default', () => {
  const { dir, cleanup } = tempTree({
    'drizzle.config.ts': "export default { schema: './s.ts', dialect: 'sqlite' };",
  });
  try {
    const location = resolveLocation(dir, undefined, undefined);
    assert.equal(location.dir, join(dir, 'drizzle'));
    assert.equal(location.source, 'default');
    assert.equal(location.dialect, 'sqlite'); // dialect still harvested
  } finally {
    cleanup();
  }
});

test('no config at all defaults to ./drizzle', () => {
  const { dir, cleanup } = tempTree({ 'package.json': '{}' });
  try {
    const location = resolveLocation(dir, undefined, undefined);
    assert.equal(location.dir, join(dir, 'drizzle'));
    assert.equal(location.source, 'default');
    assert.equal(location.dialect, undefined);
  } finally {
    cleanup();
  }
});

test('an unreadable config file (a directory) is skipped, falling back to default', () => {
  // creating a file *inside* drizzle.config.ts makes that path a directory,
  // so readFileSync throws EISDIR and the scanner swallows it
  const { dir, cleanup } = tempTree({ 'drizzle.config.ts/placeholder': 'x' });
  try {
    const location = resolveLocation(dir, undefined, undefined);
    assert.equal(location.source, 'default');
  } finally {
    cleanup();
  }
});

test('config with an absolute out: is kept as-is', () => {
  const { dir, cleanup } = tempTree({
    'drizzle.config.cjs': "module.exports = { out: '/abs/out', dialect: 'mysql' };",
  });
  try {
    const location = resolveLocation(dir, undefined, undefined);
    assert.equal(location.dir, '/abs/out');
  } finally {
    cleanup();
  }
});

test('config with out: but no dialect: leaves dialect undefined', () => {
  const { dir, cleanup } = tempTree({
    'drizzle.config.ts': "export default { schema: './s.ts', out: './migrations' };",
  });
  try {
    const location = resolveLocation(dir, undefined, undefined);
    assert.equal(location.source, 'drizzle-config');
    assert.equal(location.dialect, undefined);
  } finally {
    cleanup();
  }
});
