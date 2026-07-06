import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitStatements } from '../../src/splitter';

test('splits on the breakpoint token appended inline to a statement', () => {
  const sql = 'CREATE TABLE "users" (\n\t"id" serial\n);--> statement-breakpoint\nCREATE INDEX "i" ON "users" ("id");';
  const statements = splitStatements(sql);
  assert.equal(statements.length, 2);
  assert.match(statements[0]!.text, /^CREATE TABLE/);
  assert.equal(statements[0]!.line, 1);
  assert.match(statements[1]!.text, /^CREATE INDEX/);
  assert.equal(statements[1]!.line, 4);
});

test('splits on the breakpoint token on its own line', () => {
  const sql = 'SELECT 1;\n--> statement-breakpoint\nSELECT 2;';
  const statements = splitStatements(sql);
  assert.deepEqual(
    statements.map((s) => ({ text: s.text, line: s.line })),
    [
      { text: 'SELECT 1;', line: 1 },
      { text: 'SELECT 2;', line: 3 },
    ],
  );
});

test('a file without breakpoints is a single statement', () => {
  const statements = splitStatements('ALTER TABLE "users" ADD COLUMN "email" text;');
  assert.equal(statements.length, 1);
  assert.equal(statements[0]!.line, 1);
});

test('empty and whitespace-only pieces are dropped', () => {
  assert.deepEqual(splitStatements(''), []);
  assert.deepEqual(splitStatements('  \n \n'), []);
  const trailing = splitStatements('SELECT 1;--> statement-breakpoint\n');
  assert.equal(trailing.length, 1);
});

test('statements keep their line even after multi-line predecessors', () => {
  const sql = 'CREATE TABLE "a" (\n"x" int,\n"y" int\n);--> statement-breakpoint\n\n\nTRUNCATE "a";';
  const statements = splitStatements(sql);
  assert.equal(statements[1]!.line, 7);
});
