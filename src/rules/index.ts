import type { Dialect, Rule } from '../types';
import { dropColumn } from './universal/drop-column';
import { dropTable } from './universal/drop-table';
import { renameColumn } from './universal/rename-column';
import { renameTable } from './universal/rename-table';
import { truncateInMigration } from './universal/truncate-in-migration';

/** The catalog grows through M3 (pg statement-layer rules); findings are
 * re-sorted by file/line/rule in the engine, so registration order does not
 * affect output. */
export const RULES: readonly Rule[] = [
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
