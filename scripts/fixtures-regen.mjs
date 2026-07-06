#!/usr/bin/env node
/**
 * Regenerates every `"mode": "generated"` fixture with pinned drizzle-kit
 * versions — once in the legacy (0.31.x) artifact format and once in the v1
 * (1.0.0+) folder format — then normalizes timestamps and snapshot ids so
 * the committed output is byte-for-byte deterministic.
 *
 * Determinism check (CI runs this): npm run fixtures:regen && git diff --exit-code test/fixtures
 *
 * The CI drift probe overrides the pins to the newest dist-tags:
 *   DML_KIT_LEGACY_VERSION / DML_ORM_LEGACY_VERSION
 *   DML_KIT_V1_VERSION     / DML_ORM_V1_VERSION
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_ROOT = join(REPO_ROOT, 'test', 'fixtures');

const PINS = {
  legacy: {
    kit: process.env.DML_KIT_LEGACY_VERSION || '0.31.10',
    orm: process.env.DML_ORM_LEGACY_VERSION || '0.45.2',
  },
  v1: {
    kit: process.env.DML_KIT_V1_VERSION || '1.0.0-rc.4',
    orm: process.env.DML_ORM_V1_VERSION || '1.0.0-rc.4',
  },
};

/** Fixed, obviously-fake UUIDs that preserve the snapshot chain/DAG. */
function fixedId(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function setupRunner(format) {
  const runner = mkdtempSync(join(tmpdir(), `dml-regen-${format}-`));
  const { kit, orm } = PINS[format];
  writeJson(join(runner, 'package.json'), { name: `dml-regen-${format}`, private: true });
  console.log(`[${format}] installing drizzle-kit@${kit} + drizzle-orm@${orm} ...`);
  execFileSync(
    'npm',
    ['install', '--no-save', '--no-audit', '--no-fund', '--silent', `drizzle-kit@${kit}`, `drizzle-orm@${orm}`],
    { cwd: runner, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  return runner;
}

function generateCase(runner, caseDir, fixture) {
  const workDir = mkdtempSync(join(runner, 'case-'));
  const configPath = join(workDir, 'drizzle.config.ts');
  writeFileSync(
    configPath,
    [
      "import { defineConfig } from 'drizzle-kit';",
      'export default defineConfig({',
      "  schema: './schema.ts',",
      "  out: './out',",
      `  dialect: '${fixture.dialect}',`,
      '});',
      '',
    ].join('\n'),
  );
  for (const step of fixture.steps) {
    cpSync(join(caseDir, step.schema), join(workDir, 'schema.ts'));
    execFileSync(
      join(runner, 'node_modules', '.bin', 'drizzle-kit'),
      ['generate', '--config', 'drizzle.config.ts', '--name', step.name],
      { cwd: workDir, stdio: ['ignore', 'pipe', 'inherit'] },
    );
  }
  return join(workDir, 'out');
}

function normalizeLegacyOut(outDir) {
  const journalPath = join(outDir, 'meta', '_journal.json');
  const journal = readJson(journalPath);
  journal.entries.forEach((entry) => {
    entry.when = 1700000000000 + entry.idx;
  });
  writeJson(journalPath, journal);

  const idMap = new Map();
  const snapshots = journal.entries.map((entry) => {
    const path = join(outDir, 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`);
    const snapshot = readJson(path);
    idMap.set(snapshot.id, fixedId(entry.idx));
    return { path, snapshot };
  });
  for (const { path, snapshot } of snapshots) {
    snapshot.id = idMap.get(snapshot.id);
    snapshot.prevId = idMap.get(snapshot.prevId) ?? snapshot.prevId;
    writeJson(path, snapshot);
  }
}

function normalizeV1Out(outDir) {
  const folders = readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const idMap = new Map();
  const renamed = folders.map((name, index) => {
    const suffix = name.slice(15);
    const fixedName = `20240101${String(index).padStart(6, '0')}_${suffix}`;
    renameSync(join(outDir, name), join(outDir, fixedName));
    const snapshot = readJson(join(outDir, fixedName, 'snapshot.json'));
    idMap.set(snapshot.id, fixedId(index));
    return { fixedName, snapshot };
  });
  for (const { fixedName, snapshot } of renamed) {
    snapshot.id = idMap.get(snapshot.id);
    snapshot.prevIds = snapshot.prevIds.map((id) => idMap.get(id) ?? id);
    writeJson(join(outDir, fixedName, 'snapshot.json'), snapshot);
  }
}

function main() {
  const caseNames = readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(FIXTURES_ROOT, entry.name, 'fixture.json')))
    .map((entry) => entry.name)
    .sort();
  const generated = caseNames
    .map((name) => ({ name, dir: join(FIXTURES_ROOT, name), fixture: readJson(join(FIXTURES_ROOT, name, 'fixture.json')) }))
    .filter(({ fixture }) => fixture.mode === 'generated');
  if (generated.length === 0) {
    console.log('no generated fixtures found — nothing to do');
    return;
  }

  const runners = {};
  for (const format of ['legacy', 'v1']) {
    runners[format] = setupRunner(format);
  }
  try {
    for (const { name, dir, fixture } of generated) {
      for (const format of ['legacy', 'v1']) {
        const outDir = generateCase(runners[format], dir, fixture);
        if (format === 'legacy') {
          normalizeLegacyOut(outDir);
        } else {
          normalizeV1Out(outDir);
        }
        const target = join(dir, format);
        rmSync(target, { recursive: true, force: true });
        mkdirSync(target, { recursive: true });
        cpSync(outDir, target, { recursive: true });
        console.log(`[${format}] ${name} regenerated`);
      }
    }
  } finally {
    for (const runner of Object.values(runners)) {
      rmSync(runner, { recursive: true, force: true });
    }
  }
}

main();
