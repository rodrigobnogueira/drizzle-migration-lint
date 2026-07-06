import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPgParser, type PgParseFn } from '../../src/pg/ast';
import { constraintsOf, firstTypmodInt, typeBaseName, type ParseResult } from '../../src/pg/nodes';
import { byteOffsetToLine, extractPgStatements, statementStart } from '../../src/pg/walk';

// ---------- loader ----------

test('loadPgParser returns a working parse function with the real module', async () => {
  const parse = await loadPgParser();
  assert.ok(parse, 'parser should load');
  const result = parse('SELECT 1;');
  assert.equal(result.stmts?.length, 1);
});

test('loadPgParser returns null when the import throws', async () => {
  const parser = await loadPgParser(async () => {
    throw new Error('no module here');
  });
  assert.equal(parser, null);
});

test('loadPgParser returns null when loadModule throws', async () => {
  const parser = await loadPgParser(async () => ({
    loadModule: async () => {
      throw new Error('wasm boom');
    },
    parseSync: () => ({ stmts: [] }),
  }));
  assert.equal(parser, null);
});

// ---------- byteOffsetToLine / statementStart ----------

test('byteOffsetToLine counts newlines and clamps past the end', () => {
  const sql = 'a\nb\nc';
  assert.equal(byteOffsetToLine(sql, 0), 1);
  assert.equal(byteOffsetToLine(sql, 2), 2);
  assert.equal(byteOffsetToLine(sql, 999), 3);
});

test('statementStart skips whitespace and --> breakpoint comments', () => {
  const sql = 'A;--> statement-breakpoint\nBBB;';
  const start = statementStart(sql, 2); // pg_query points here (at the comment)
  assert.equal(sql.slice(start, start + 3), 'BBB');
  assert.equal(byteOffsetToLine(sql, start), 2);
});

test('statementStart clamps a negative offset and stops at a real token', () => {
  assert.equal(statementStart('  SELECT', -5), 2);
});

test('statementStart returns end when a trailing comment has no newline', () => {
  const sql = 'SELECT 1;-- trailing comment no newline';
  assert.equal(statementStart(sql, 9), sql.length);
});

// ---------- extractPgStatements ----------

test('extractPgStatements maps statements to kinds and lines (golden)', async () => {
  const parse = (await loadPgParser())!;
  const sql = 'CREATE INDEX "i" ON "users" ("email");--> statement-breakpoint\nTRUNCATE "users";';
  const statements = extractPgStatements(parse, sql);
  assert.deepEqual(
    statements.map((s) => ({ kind: s.kind, line: s.line })),
    [
      { kind: 'IndexStmt', line: 1 },
      { kind: 'TruncateStmt', line: 2 },
    ],
  );
});

test('golden AST: the ADD COLUMN NOT NULL node shape is pinned', async () => {
  const parse = (await loadPgParser())!;
  const [statement] = extractPgStatements(parse, 'ALTER TABLE "t" ADD COLUMN "c" integer NOT NULL;');
  assert.equal(statement!.kind, 'AlterTableStmt');
  const cmd = (statement!.node as { cmds: { AlterTableCmd: { subtype: string; def: { ColumnDef: { constraints: { Constraint: { contype: string } }[] } } } }[] }).cmds[0]!.AlterTableCmd;
  assert.equal(cmd.subtype, 'AT_AddColumn');
  assert.equal(cmd.def.ColumnDef.constraints[0]!.Constraint.contype, 'CONSTR_NOTNULL');
});

test('extractPgStatements skips statements with no node kind and empty results', () => {
  const fakeEmpty: PgParseFn = () => ({}) as ParseResult;
  assert.deepEqual(extractPgStatements(fakeEmpty, 'x'), []);
  const fakeNoKind: PgParseFn = () => ({ stmts: [{ stmt: {} }] });
  assert.deepEqual(extractPgStatements(fakeNoKind, 'x'), []);
});

// ---------- nodes helpers ----------

test('typeBaseName returns the last segment or null', () => {
  assert.equal(typeBaseName({ names: [{ String: { sval: 'pg_catalog' } }, { String: { sval: 'int8' } }] }), 'int8');
  assert.equal(typeBaseName(undefined), null);
  assert.equal(typeBaseName({ names: [] }), null);
  assert.equal(typeBaseName({ names: [{}] }), null); // segment without String.sval
});

test('firstTypmodInt reads an integer typmod or null', () => {
  assert.equal(firstTypmodInt({ typmods: [{ A_Const: { ival: { ival: 42 } } }] }), 42);
  assert.equal(firstTypmodInt(undefined), null);
  assert.equal(firstTypmodInt({ typmods: [{ A_Const: {} }] }), null);
  assert.equal(firstTypmodInt({ typmods: [{ A_Const: { ival: { ival: 'x' } } }] }), null); // non-integer
});

test('constraintsOf unwraps and drops empty entries', () => {
  assert.deepEqual(constraintsOf(undefined), []);
  assert.deepEqual(
    constraintsOf({ constraints: [{}, { Constraint: { contype: 'CONSTR_NOTNULL' } }] }),
    [{ contype: 'CONSTR_NOTNULL' }],
  );
});
