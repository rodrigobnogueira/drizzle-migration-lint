import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PgExpr } from '../../src/pg/nodes';
import { classifyDefault } from '../../src/pg/volatility';

function funcCall(...segments: string[]): PgExpr {
  return { FuncCall: { funcname: segments.map((sval) => ({ String: { sval } })) } };
}

test('no default expression is safe', () => {
  assert.deepEqual(classifyDefault(undefined), { kind: 'safe' });
});

test('a known volatile function flags with its name', () => {
  assert.deepEqual(classifyDefault(funcCall('gen_random_uuid')), { kind: 'volatile', fn: 'gen_random_uuid' });
  assert.deepEqual(classifyDefault(funcCall('pg_catalog', 'random')), { kind: 'volatile', fn: 'random' });
});

test('now() and other stable clock functions are safe', () => {
  assert.deepEqual(classifyDefault(funcCall('now')), { kind: 'safe' });
  assert.deepEqual(classifyDefault(funcCall('current_date')), { kind: 'safe' });
});

test('CURRENT_TIMESTAMP (SQLValueFunction, no funcname) is safe', () => {
  assert.deepEqual(classifyDefault({ SQLValueFunction: { op: 'SVFOP_CURRENT_TIMESTAMP' } }), { kind: 'safe' });
});

test('a plain constant is safe', () => {
  assert.deepEqual(classifyDefault({ A_Const: { ival: { ival: 0 } } }), { kind: 'safe' });
});

test('an unrecognized function cannot be verified', () => {
  assert.deepEqual(classifyDefault(funcCall('my_custom_default')), {
    kind: 'unknown-fn',
    fn: 'my_custom_default',
  });
});

test('a FuncCall with an empty funcname is treated as safe', () => {
  assert.deepEqual(classifyDefault({ FuncCall: { funcname: [] } }), { kind: 'safe' });
});

test('a FuncCall whose name segment lacks a value is treated as safe', () => {
  assert.deepEqual(classifyDefault({ FuncCall: { funcname: [{}] } }), { kind: 'safe' });
});
