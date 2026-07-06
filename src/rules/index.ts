import type { Dialect, Rule } from '../types';
import { addCheckWithoutNotValid } from './pg/add-check-without-not-valid';
import { addColumnNotNullNoDefault } from './pg/add-column-not-null-no-default';
import { addFkWithoutNotValid } from './pg/add-fk-without-not-valid';
import { addPrimaryKeyOnExistingTable } from './pg/add-primary-key-on-existing-table';
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
  volatileDefaultOnAddColumn,
  dropColumn,
  dropTable,
  renameColumn,
  renameTable,
  truncateInMigration,
];

/** All registered rule ids — used to tell a suppression's rule-id list apart
 * from a free-text reason. */
export const RULE_IDS: ReadonlySet<string> = new Set(RULES.map((rule) => rule.id));

export function ruleAppliesTo(rule: Rule, dialect: Dialect): boolean {
  return rule.dialects === 'all' || rule.dialects.includes(dialect);
}
