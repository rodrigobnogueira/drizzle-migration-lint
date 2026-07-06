import type { IndexStmt } from '../../pg/nodes';
import type { Finding, Rule, RuleContext } from '../../types';
import { pgFinding, pgTableIdentity } from './support';

const SUGGESTION =
  'Build it with .concurrently() (CREATE INDEX CONCURRENTLY) AND move it to its own migration ' +
  'applied outside a transaction — drizzle wraps each migration in a transaction, where ' +
  'CONCURRENTLY fails. See the docs recipe (drizzle-kit generate --custom + a no-transaction runner step).';

export const createIndexNonConcurrently: Rule = {
  id: 'create-index-non-concurrently',
  severity: 'error',
  dialects: ['postgresql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const statement of ctx.pgStatements) {
      if (statement.kind !== 'IndexStmt') {
        continue;
      }
      const index = statement.node as unknown as IndexStmt;
      const table = pgTableIdentity(index.relation);
      if (index.concurrent === true || ctx.newTables.has(table)) {
        continue;
      }
      findings.push(
        pgFinding(
          ctx,
          this.id,
          statement.line,
          `Creating an index on "${table}" without CONCURRENTLY blocks all writes to the table for the entire build.`,
          SUGGESTION,
        ),
      );
    }
    return findings;
  },
};
