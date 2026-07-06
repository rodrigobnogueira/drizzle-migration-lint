import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lint } from '../../src/engine';
import { degradedPgScan } from '../../src/rules/pg/degraded';
import { splitStatements } from '../../src/splitter';
import type { Migration, MigrationSet } from '../../src/types';

function migration(sql: string): Migration {
  return {
    id: 'm',
    index: 1,
    sqlPath: 'm.sql',
    sql,
    statements: splitStatements(sql),
    snapshot: null,
    prevSnapshot: null,
    isFirst: false,
  };
}

function pgSet(sql: string): MigrationSet {
  return { format: 'v1', dialect: 'postgresql', dir: '/x', migrations: [migration(sql)], diagnostics: [] };
}

// ---------- degradedPgScan directly ----------

test('degraded scan flags a non-concurrent index but skips CONCURRENTLY and new tables', () => {
  assert.equal(degradedPgScan(migration('CREATE INDEX "i" ON "users" ("e");'), new Set()).length, 1);
  assert.equal(degradedPgScan(migration('CREATE UNIQUE INDEX CONCURRENTLY "i" ON "users" ("e");'), new Set()).length, 0);
  assert.equal(degradedPgScan(migration('CREATE INDEX "i" ON "users" ("e");'), new Set(['users'])).length, 0);
});

test('degraded scan flags FK and CHECK without NOT VALID, skips with it', () => {
  const fk = 'ALTER TABLE "t" ADD CONSTRAINT "f" FOREIGN KEY ("c") REFERENCES "u"("id")';
  assert.equal(degradedPgScan(migration(`${fk};`), new Set())[0]!.rule, 'add-fk-without-not-valid');
  assert.equal(degradedPgScan(migration(`${fk} NOT VALID;`), new Set()).length, 0);
  assert.equal(degradedPgScan(migration(`${fk};`), new Set(['t'])).length, 0);

  const chk = 'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK ("x" > 0);';
  assert.equal(degradedPgScan(migration(chk), new Set())[0]!.rule, 'add-check-without-not-valid');
});

test('degraded scan ignores unrelated statements and add-constraint without fk/check', () => {
  assert.equal(degradedPgScan(migration('ALTER TABLE "t" ADD CONSTRAINT "u" UNIQUE ("c");'), new Set()).length, 0);
  assert.equal(degradedPgScan(migration('DROP TABLE "t";'), new Set()).length, 0);
});

test('degraded index scan still flags when the target table is unparseable', () => {
  // no ON clause → target regex misses → table is null but the risk stands
  assert.equal(degradedPgScan(migration('CREATE INDEX "i";'), new Set())[0]!.rule, 'create-index-non-concurrently');
});

// ---------- engine seams ----------

test('engine emits pg-parser-unavailable and degrades when the parser will not load', async () => {
  const result = await lint(pgSet('CREATE INDEX "i" ON "users" ("e");'), { loadParser: async () => null });
  assert.ok(result.diagnostics.some((d) => d.code === 'pg-parser-unavailable'));
  const active = result.findings.filter((f) => f.rule === 'create-index-non-concurrently');
  assert.equal(active.length, 1);
  assert.match(active[0]!.message, /regex-degraded mode/);
});

test('engine tolerates a parser that throws on a malformed file (no crash)', async () => {
  const throwingParser = async () => () => {
    throw new Error('unparseable SQL');
  };
  const result = await lint(pgSet('CREATE INDEX "i" ON "users" ("e");'), { loadParser: throwingParser });
  // AST rules produced nothing (parse failed) but the run completed cleanly
  assert.equal(result.findings.length, 0);
  assert.equal(result.diagnostics.length, 0);
});
