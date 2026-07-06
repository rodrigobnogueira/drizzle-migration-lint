import type { DiffOp, Finding, Rule, RuleContext, RuleId } from '../../types';
import { docsUrlFor } from '../docs-url';

type OpOf<K extends DiffOp['kind']> = Extract<DiffOp, { kind: K }>;
type Describe<K extends DiffOp['kind']> = (op: OpOf<K>) => { message: string; suggestion: string };

/** All four structural rules share the same shape: filter the migration's
 * diff for one op kind and turn each into a `warn` finding on every dialect.
 * The new-table exemption is already baked into the differ — it only emits
 * drop/rename ops for tables that existed before this migration. */
export function makeStructuralRule<K extends DiffOp['kind']>(
  id: RuleId,
  kind: K,
  describe: Describe<K>,
): Rule {
  return {
    id,
    severity: 'warn',
    dialects: 'all',
    check(ctx: RuleContext): Finding[] {
      const findings: Finding[] = [];
      for (const op of ctx.diffOps) {
        if (op.kind === kind) {
          const { message, suggestion } = describe(op as OpOf<K>);
          findings.push({
            rule: id,
            severity: 'warn',
            message,
            suggestion,
            file: ctx.migration.sqlPath,
            line: op.line,
            migration: ctx.migration.id,
            suppressed: false,
            docsUrl: docsUrlFor(id),
          });
        }
      }
      return findings;
    },
  };
}
