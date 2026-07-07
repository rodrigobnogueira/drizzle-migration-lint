import { tableIdentity } from '../../identifiers';
import type { AlterEnumStmt } from '../../pg/nodes';
import type { Finding, Rule, RuleContext } from '../../types';
import { pgFinding } from './support';

const SUGGESTION =
  'Put ADD VALUE in its own migration and do not use the new value until a later one. ' +
  'On PostgreSQL < 12 it cannot run inside a transaction at all (drizzle wraps each ' +
  'migration in one); on 12+ the new value is unusable until the transaction commits.';

/** enum identity from its `[schema?, name]` type-name string nodes. */
function enumIdentity(node: AlterEnumStmt): string {
  const names = (node.typeName ?? [])
    .map((segment) => segment.String?.sval)
    .filter((value): value is string => value !== undefined);
  const name = names.at(-1) ?? '';
  const schema = names.length >= 2 ? (names.at(-2) as string) : null;
  return tableIdentity(schema, name);
}

export const addEnumValue: Rule = {
  id: 'add-enum-value',
  severity: 'warn',
  dialects: ['postgresql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const statement of ctx.pgStatements) {
      if (statement.kind !== 'AlterEnumStmt') {
        continue;
      }
      const node = statement.node as unknown as AlterEnumStmt;
      // ADD VALUE carries newVal with no oldVal; RENAME VALUE carries both.
      if (node.newVal === undefined || node.oldVal !== undefined) {
        continue;
      }
      findings.push(
        pgFinding(
          ctx,
          this.id,
          statement.line,
          `Adding a value to enum "${enumIdentity(node)}" runs inside drizzle's per-migration transaction, where ADD VALUE is restricted.`,
          SUGGESTION,
          { severity: 'warn' },
        ),
      );
    }
    return findings;
  },
};
