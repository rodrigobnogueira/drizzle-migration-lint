import type { Dialect, Rule, RuleId } from '../types';
import { addCheckWithoutNotValid } from './pg/add-check-without-not-valid';
import { addColumnNotNullNoDefault } from './pg/add-column-not-null-no-default';
import { addEnumValue } from './pg/add-enum-value';
import { addFkWithoutNotValid } from './pg/add-fk-without-not-valid';
import { addPrimaryKeyOnExistingTable } from './pg/add-primary-key-on-existing-table';
import { addUniqueConstraint } from './pg/add-unique-constraint';
import { alterColumnType } from './pg/alter-column-type';
import { createIndexNonConcurrently } from './pg/create-index-non-concurrently';
import { setNotNull } from './pg/set-not-null';
import { volatileDefaultOnAddColumn } from './pg/volatile-default-on-add-column';
import { dropColumn } from './universal/drop-column';
import { dropTable } from './universal/drop-table';
import { renameColumn } from './universal/rename-column';
import { renameTable } from './universal/rename-table';
import { truncateInMigration } from './universal/truncate-in-migration';

/** Findings are re-sorted by file/line/rule in the engine, so registration
 * order does not affect output. */
export const RULES: readonly Rule[] = [
  createIndexNonConcurrently,
  addColumnNotNullNoDefault,
  setNotNull,
  alterColumnType,
  addFkWithoutNotValid,
  addCheckWithoutNotValid,
  addPrimaryKeyOnExistingTable,
  addUniqueConstraint,
  volatileDefaultOnAddColumn,
  addEnumValue,
  dropColumn,
  dropTable,
  renameColumn,
  renameTable,
  truncateInMigration,
];

/** All registered rule ids — used to tell a suppression's rule-id list apart
 * from a free-text reason. */
export const RULE_IDS: ReadonlySet<string> = new Set(RULES.map((rule) => rule.id));

/** Rules whose risk is proportional to table size — a lock or rewrite that is
 * brief on a small table. Only these are eligible for size-exemption. NOT
 * included: add-column-not-null-no-default (fails on any non-empty table),
 * add-enum-value (transaction restriction), or the rolling-deploy/data-loss
 * warns (drops, renames, truncate) — size never makes those safe. */
export const SIZE_SENSITIVE_RULES: ReadonlySet<RuleId> = new Set<RuleId>([
  'create-index-non-concurrently',
  'set-not-null',
  'alter-column-type',
  'add-fk-without-not-valid',
  'add-check-without-not-valid',
  'add-primary-key-on-existing-table',
  'add-unique-constraint',
  'volatile-default-on-add-column',
]);

export function ruleAppliesTo(rule: Rule, dialect: Dialect): boolean {
  return rule.dialects === 'all' || rule.dialects.includes(dialect);
}
