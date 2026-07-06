import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from './errors';
import { RULE_IDS } from './rules';

/** docs/rules.md ships alongside dist/ in the package (see package.json files). */
const RULES_DOC = join(__dirname, '..', 'docs', 'rules.md');

/** Returns the `## <rule>` section of docs/rules.md — the single source of
 * truth for rule rationale — for `drizzle-migration-lint explain <rule>`.
 * Throws UsageError for a missing or unknown rule id. */
export function explainRule(rule: string | undefined, docPath: string = RULES_DOC): string {
  if (rule === undefined) {
    throw new UsageError('usage: drizzle-migration-lint explain <rule-id>');
  }
  if (!RULE_IDS.has(rule)) {
    throw new UsageError(`unknown rule "${rule}". Known rules: ${[...RULE_IDS].sort().join(', ')}`);
  }
  const doc = readFileSync(docPath, 'utf8');
  const heading = `## ${rule}`;
  const start = doc.indexOf(`\n${heading}\n`);
  if (start === -1) {
    throw new UsageError(`no documentation section for "${rule}" in ${docPath}`);
  }
  const next = doc.indexOf('\n## ', start + heading.length + 1);
  const end = next === -1 ? doc.length : next;
  return doc.slice(start + 1, end).trim();
}
