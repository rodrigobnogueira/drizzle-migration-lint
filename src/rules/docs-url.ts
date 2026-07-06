import type { RuleId } from '../types';

const DOCS_BASE =
  'https://github.com/rodrigobnogueira/drizzle-migration-lint/blob/main/docs/rules.md';

export function docsUrlFor(rule: RuleId): string {
  return `${DOCS_BASE}#${rule}`;
}
