import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TypeName } from '../../src/pg/nodes';
import {
  isSafeWidening,
  parseAstType,
  parseSnapshotType,
  type CanonicalType,
} from '../../src/rules/type-widening';

function astType(base: string, ...mods: number[]): TypeName {
  return {
    names: [{ String: { sval: base } }],
    typmods: mods.map((value) => ({ A_Const: { ival: { ival: value } } })),
  };
}

test('parseSnapshotType canonicalizes aliases and reads modifiers', () => {
  assert.deepEqual(parseSnapshotType('bigint'), { base: 'int8', mods: [] });
  assert.deepEqual(parseSnapshotType('integer'), { base: 'int4', mods: [] });
  assert.deepEqual(parseSnapshotType('varchar(20)'), { base: 'varchar', mods: [20] });
  assert.deepEqual(parseSnapshotType('varchar'), { base: 'varchar', mods: [] });
  assert.deepEqual(parseSnapshotType('numeric(10, 2)'), { base: 'numeric', mods: [10, 2] });
  assert.deepEqual(parseSnapshotType('timestamp with time zone'), { base: 'timestamptz', mods: [] });
  assert.deepEqual(parseSnapshotType('timestamp(3) with time zone'), { base: 'timestamptz', mods: [3] });
  assert.deepEqual(parseSnapshotType('text'), { base: 'text', mods: [] });
  assert.deepEqual(parseSnapshotType('jsonb'), { base: 'jsonb', mods: [] });
});

test('parseSnapshotType tolerates an unterminated modifier', () => {
  assert.deepEqual(parseSnapshotType('varchar(20'), { base: 'varchar', mods: [20] });
});

test('parseAstType canonicalizes internal names and typmods', () => {
  assert.deepEqual(parseAstType(astType('int8')), { base: 'int8', mods: [] });
  assert.deepEqual(parseAstType(astType('varchar', 255)), { base: 'varchar', mods: [255] });
  assert.deepEqual(parseAstType(astType('numeric', 10, 2)), { base: 'numeric', mods: [10, 2] });
  assert.equal(parseAstType(undefined), null);
  assert.equal(parseAstType({ names: [] }), null);
});

test('parseAstType ignores a non-integer second typmod', () => {
  const weird: TypeName = {
    names: [{ String: { sval: 'numeric' } }],
    typmods: [{ A_Const: { ival: { ival: 10 } } }, { A_Const: {} }],
  };
  assert.deepEqual(parseAstType(weird), { base: 'numeric', mods: [10] });
});

const T = (base: string, ...mods: number[]): CanonicalType => ({ base, mods });

test('isSafeWidening: varchar length grows or goes unbounded, and to text', () => {
  assert.equal(isSafeWidening(T('varchar', 10), T('varchar', 20)), true);
  assert.equal(isSafeWidening(T('varchar', 20), T('varchar', 10)), false);
  assert.equal(isSafeWidening(T('varchar', 10), T('varchar')), true);
  assert.equal(isSafeWidening(T('varchar', 10), T('text')), true);
  assert.equal(isSafeWidening(T('text'), T('varchar', 10)), false);
});

test('isSafeWidening: integer promotions are never safe', () => {
  assert.equal(isSafeWidening(T('int4'), T('int8')), false);
  assert.equal(isSafeWidening(T('int2'), T('int4')), false);
});

test('isSafeWidening: numeric precision may grow, scale must hold', () => {
  assert.equal(isSafeWidening(T('numeric', 10, 2), T('numeric', 12, 2)), true);
  assert.equal(isSafeWidening(T('numeric', 10, 2), T('numeric', 10, 3)), false);
  assert.equal(isSafeWidening(T('numeric', 12, 2), T('numeric', 10, 2)), false);
  assert.equal(isSafeWidening(T('numeric', 10, 2), T('numeric')), true);
});

test('isSafeWidening: time/timestamp precision widenings', () => {
  assert.equal(isSafeWidening(T('timestamptz', 3), T('timestamptz', 6)), true);
  assert.equal(isSafeWidening(T('timestamp', 6), T('timestamp', 3)), false);
  assert.equal(isSafeWidening(T('time', 0), T('time')), true);
  assert.equal(isSafeWidening(T('varbit', 8), T('varbit', 16)), true);
});

test('isSafeWidening: same non-widenable base and cross-base changes are unsafe', () => {
  assert.equal(isSafeWidening(T('int4'), T('int4')), false);
  assert.equal(isSafeWidening(T('bpchar', 4), T('bpchar', 8)), false);
  assert.equal(isSafeWidening(T('numeric', 10, 2), T('int8')), false);
});
