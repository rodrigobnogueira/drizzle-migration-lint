import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCheckWithoutNotValid } from '../../src/rules/pg/add-check-without-not-valid';
import { addColumnNotNullNoDefault } from '../../src/rules/pg/add-column-not-null-no-default';
import { addEnumValue } from '../../src/rules/pg/add-enum-value';
import { addFkWithoutNotValid } from '../../src/rules/pg/add-fk-without-not-valid';
import { addPrimaryKeyOnExistingTable } from '../../src/rules/pg/add-primary-key-on-existing-table';
import { addUniqueConstraint } from '../../src/rules/pg/add-unique-constraint';
import { alterColumnType } from '../../src/rules/pg/alter-column-type';
import { createIndexNonConcurrently } from '../../src/rules/pg/create-index-non-concurrently';
import { setNotNull } from '../../src/rules/pg/set-not-null';
import { volatileDefaultOnAddColumn } from '../../src/rules/pg/volatile-default-on-add-column';
import type { Migration, MigrationSet, Rule, RuleContext } from '../../src/types';
import { pgContext, snapshotWithColumns } from '../support/pg';

async function run(rule: Rule, sql: string, opts?: Parameters<typeof pgContext>[1]) {
  return rule.check(await pgContext(sql, opts));
}

// ---------- create-index-non-concurrently ----------

test('create-index flags a plain index on an existing table', async () => {
  const findings = await run(createIndexNonConcurrently, 'CREATE INDEX "i" ON "users" ("email");');
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /without CONCURRENTLY/);
});

test('create-index skips CONCURRENTLY and new tables', async () => {
  assert.equal((await run(createIndexNonConcurrently, 'CREATE INDEX CONCURRENTLY "i" ON "users" ("e");')).length, 0);
  assert.equal((await run(createIndexNonConcurrently, 'CREATE INDEX "i" ON "users" ("e");', { newTables: ['users'] })).length, 0);
});

// ---------- add-column-not-null-no-default ----------

test('add-column-not-null-no-default flags, but not with a default or when nullable', async () => {
  assert.equal((await run(addColumnNotNullNoDefault, 'ALTER TABLE "t" ADD COLUMN "c" int NOT NULL;')).length, 1);
  assert.equal((await run(addColumnNotNullNoDefault, 'ALTER TABLE "t" ADD COLUMN "c" int NOT NULL DEFAULT 0;')).length, 0);
  assert.equal((await run(addColumnNotNullNoDefault, 'ALTER TABLE "t" ADD COLUMN "c" int;')).length, 0);
  assert.equal((await run(addColumnNotNullNoDefault, 'ALTER TABLE "t" ADD COLUMN "c" int NOT NULL;', { newTables: ['t'] })).length, 0);
});

// ---------- set-not-null ----------

test('set-not-null flags on an existing table only', async () => {
  assert.equal((await run(setNotNull, 'ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL;')).length, 1);
  assert.equal((await run(setNotNull, 'ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL;', { newTables: ['t'] })).length, 0);
});

// ---------- alter-column-type ----------

test('alter-column-type flags a non-widening change (int → bigint)', async () => {
  const findings = await run(
    alterColumnType,
    'ALTER TABLE "t" ALTER COLUMN "n" SET DATA TYPE bigint USING "n"::bigint;',
    { prevSnapshot: snapshotWithColumns('t', { n: 'integer' }) },
  );
  assert.equal(findings.length, 1);
  assert.doesNotMatch(findings[0]!.message, /USING clause/); // drizzle's trivial cast → no USING note
});

test('alter-column-type skips a whitelisted widening despite drizzle\'s trivial USING', async () => {
  const findings = await run(
    alterColumnType,
    'ALTER TABLE "t" ALTER COLUMN "s" SET DATA TYPE varchar(20) USING "s"::varchar(20);',
    { prevSnapshot: snapshotWithColumns('t', { s: 'varchar(10)' }) },
  );
  assert.equal(findings.length, 0);
});

test('alter-column-type flags a non-trivial USING expression with a note', async () => {
  const findings = await run(
    alterColumnType,
    'ALTER TABLE "t" ALTER COLUMN "s" SET DATA TYPE varchar(20) USING upper("s");',
    { prevSnapshot: snapshotWithColumns('t', { s: 'varchar(10)' }) },
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /USING clause forces a full-table rewrite/);
});

test('alter-column-type flags when the previous type is unknown', async () => {
  const findings = await run(alterColumnType, 'ALTER TABLE "t" ALTER COLUMN "s" SET DATA TYPE varchar(20) USING "s"::varchar(20);');
  assert.equal(findings.length, 1);
});

test('alter-column-type skips a new table', async () => {
  const findings = await run(
    alterColumnType,
    'ALTER TABLE "t" ALTER COLUMN "n" SET DATA TYPE bigint USING "n"::bigint;',
    { newTables: ['t'], prevSnapshot: snapshotWithColumns('t', { n: 'integer' }) },
  );
  assert.equal(findings.length, 0);
});

// ---------- add-fk / add-check without NOT VALID ----------

test('add-fk flags without NOT VALID, skips with it and on new tables', async () => {
  const fk = 'ALTER TABLE "t" ADD CONSTRAINT "f" FOREIGN KEY ("c") REFERENCES "u"("id")';
  assert.equal((await run(addFkWithoutNotValid, `${fk};`)).length, 1);
  assert.equal((await run(addFkWithoutNotValid, `${fk} NOT VALID;`)).length, 0);
  assert.equal((await run(addFkWithoutNotValid, `${fk};`, { newTables: ['t'] })).length, 0);
  // a CHECK constraint is not an FK
  assert.equal((await run(addFkWithoutNotValid, 'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (x > 0);')).length, 0);
});

test('add-check flags without NOT VALID, skips with it and on new tables', async () => {
  const chk = 'ALTER TABLE "t" ADD CONSTRAINT "c" CHECK (x > 0)';
  assert.equal((await run(addCheckWithoutNotValid, `${chk};`)).length, 1);
  assert.equal((await run(addCheckWithoutNotValid, `${chk} NOT VALID;`)).length, 0);
  assert.equal((await run(addCheckWithoutNotValid, `${chk};`, { newTables: ['t'] })).length, 0);
});

// ---------- add-primary-key ----------

test('add-primary-key flags, skips USING INDEX and new tables, and ignores VALIDATE', async () => {
  assert.equal((await run(addPrimaryKeyOnExistingTable, 'ALTER TABLE "t" ADD CONSTRAINT "p" PRIMARY KEY ("id");')).length, 1);
  assert.equal((await run(addPrimaryKeyOnExistingTable, 'ALTER TABLE "t" ADD CONSTRAINT "p" PRIMARY KEY USING INDEX "idx";')).length, 0);
  assert.equal((await run(addPrimaryKeyOnExistingTable, 'ALTER TABLE "t" ADD CONSTRAINT "p" PRIMARY KEY ("id");', { newTables: ['t'] })).length, 0);
  // the safe second step of a NOT VALID sequence must stay silent
  assert.equal((await run(addPrimaryKeyOnExistingTable, 'ALTER TABLE "t" VALIDATE CONSTRAINT "f";')).length, 0);
});

// ---------- add-unique-constraint ----------

test('add-unique-constraint flags, skips USING INDEX and new tables, ignores non-unique', async () => {
  assert.equal((await run(addUniqueConstraint, 'ALTER TABLE "t" ADD CONSTRAINT "u" UNIQUE ("c");')).length, 1);
  assert.equal((await run(addUniqueConstraint, 'ALTER TABLE "t" ADD CONSTRAINT "u" UNIQUE USING INDEX "idx";')).length, 0);
  assert.equal((await run(addUniqueConstraint, 'ALTER TABLE "t" ADD CONSTRAINT "u" UNIQUE ("c");', { newTables: ['t'] })).length, 0);
  assert.equal((await run(addUniqueConstraint, 'ALTER TABLE "t" ADD CONSTRAINT "p" PRIMARY KEY ("id");')).length, 0);
});

// ---------- add-enum-value ----------

test('add-enum-value warns on ADD VALUE (schema-qualified too), not on RENAME VALUE', async () => {
  const bare = await run(addEnumValue, `ALTER TYPE "status" ADD VALUE 'banned';`);
  assert.equal(bare.length, 1);
  assert.equal(bare[0]!.severity, 'warn');
  assert.match(bare[0]!.message, /enum "status"/);

  const qualified = await run(addEnumValue, `ALTER TYPE "auth"."status" ADD VALUE 'x' BEFORE 'y';`);
  assert.equal(qualified.length, 1);
  assert.match(qualified[0]!.message, /enum "auth\.status"/);

  assert.equal((await run(addEnumValue, `ALTER TYPE "status" RENAME VALUE 'a' TO 'b';`)).length, 0);
  assert.equal((await run(addEnumValue, 'ALTER TABLE "t" ADD COLUMN "c" int;')).length, 0);
});

// ---------- volatile-default ----------

test('volatile-default flags volatile functions and softly flags unknown ones', async () => {
  const volatile = await run(volatileDefaultOnAddColumn, 'ALTER TABLE "t" ADD COLUMN "c" uuid DEFAULT gen_random_uuid();');
  assert.equal(volatile.length, 1);
  assert.match(volatile[0]!.message, /volatile default/);

  const unknown = await run(volatileDefaultOnAddColumn, 'ALTER TABLE "t" ADD COLUMN "c" int DEFAULT my_fn();');
  assert.equal(unknown.length, 1);
  assert.match(unknown[0]!.message, /cannot verify/);
});

test('volatile-default is silent for stable and constant defaults, and new tables', async () => {
  assert.equal((await run(volatileDefaultOnAddColumn, 'ALTER TABLE "t" ADD COLUMN "c" timestamptz DEFAULT now();')).length, 0);
  assert.equal((await run(volatileDefaultOnAddColumn, 'ALTER TABLE "t" ADD COLUMN "c" int DEFAULT 5;')).length, 0);
  assert.equal((await run(volatileDefaultOnAddColumn, 'ALTER TABLE "t" ADD COLUMN "c" int;')).length, 0);
  assert.equal((await run(volatileDefaultOnAddColumn, 'ALTER TABLE "t" ADD COLUMN "c" uuid DEFAULT gen_random_uuid();', { newTables: ['t'] })).length, 0);
});

// ---------- defensive fallbacks: a malformed AST missing optional fields ----------

/** Builds a context from a hand-crafted AST node, to exercise the `?? fallback`
 * guards for fields (relation, cmd name) that real drizzle output always sets. */
function syntheticContext(node: Record<string, unknown>, kind = 'AlterTableStmt'): RuleContext {
  const migration: Migration = {
    id: 'm', index: 1, sqlPath: 'm.sql', sql: '', statements: [],
    snapshot: null, prevSnapshot: null, isFirst: false,
  };
  const set: MigrationSet = { format: 'v1', dialect: 'postgresql', dir: '/x', migrations: [migration], diagnostics: [] };
  return { set, migration, newTables: new Set(), diffOps: [], pgStatements: [{ kind, node, line: 1 }] };
}

test('rules tolerate an AlterTableStmt with no relation, an empty cmd, and a nameless column', () => {
  const findings = alterColumnType.check(
    syntheticContext({
      // no `relation` → table identity falls back to ''
      cmds: [
        {}, // no AlterTableCmd → skipped
        { AlterTableCmd: { subtype: 'AT_AlterColumnType', def: { ColumnDef: { typeName: { names: [{ String: { sval: 'int8' } }] } } } } }, // no `name`
      ],
    }),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0]!.message, /rewrites the whole table/);
});

test('add-column and set-not-null fall back to generic names for a nameless column', () => {
  const addFindings = addColumnNotNullNoDefault.check(
    syntheticContext({ cmds: [{ AlterTableCmd: { subtype: 'AT_AddColumn', def: { ColumnDef: { constraints: [{ Constraint: { contype: 'CONSTR_NOTNULL' } }] } } } }] }),
  );
  assert.match(addFindings[0]!.message, /the new column/);

  const setFindings = setNotNull.check(
    syntheticContext({ cmds: [{ AlterTableCmd: { subtype: 'AT_SetNotNull' } }] }),
  );
  assert.match(setFindings[0]!.message, /the column/);

  const volFindings = volatileDefaultOnAddColumn.check(
    syntheticContext({ cmds: [{ AlterTableCmd: { subtype: 'AT_AddColumn', def: { ColumnDef: { constraints: [{ Constraint: { contype: 'CONSTR_DEFAULT', raw_expr: { FuncCall: { funcname: [{ String: { sval: 'gen_random_uuid' } }] } } } }] } } } }] }),
  );
  assert.match(volFindings[0]!.message, /the new column/);
});

test('add-enum-value tolerates a missing/degenerate typeName', () => {
  // no typeName at all → empty identity, still flagged
  const noName = addEnumValue.check(syntheticContext({ newVal: 'x' }, 'AlterEnumStmt'));
  assert.equal(noName.length, 1);
  assert.match(noName[0]!.message, /enum ""/);
  // a segment with no String.sval is dropped; the remaining one names the enum
  const partial = addEnumValue.check(
    syntheticContext({ typeName: [{}, { String: { sval: 'e' } }], newVal: 'x' }, 'AlterEnumStmt'),
  );
  assert.match(partial[0]!.message, /enum "e"/);
});

test('add-constraint rules skip an AT_AddConstraint command carrying no constraint', () => {
  const findings = addFkWithoutNotValid.check(
    syntheticContext({ cmds: [{ AlterTableCmd: { subtype: 'AT_AddConstraint' } }] }),
  );
  assert.equal(findings.length, 0);
});

test('an AlterTableStmt with no cmds array yields nothing', () => {
  assert.equal(setNotNull.check(syntheticContext({})).length, 0);
});
