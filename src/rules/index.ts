import type { Dialect, Rule } from '../types';
import { truncateInMigration } from './universal/truncate-in-migration';

/** The full catalog grows through M2 (structural rules) and M3 (pg
 * statement-layer rules); registration order is reporting order. */
export const RULES: readonly Rule[] = [truncateInMigration];

export function ruleAppliesTo(rule: Rule, dialect: Dialect): boolean {
  return rule.dialects === 'all' || rule.dialects.includes(dialect);
}
