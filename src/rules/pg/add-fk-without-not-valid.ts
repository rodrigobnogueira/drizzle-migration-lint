import type { Finding, Rule, RuleContext } from '../../types';
import { addConstraintCommands, pgFinding } from './support';

const SUGGESTION =
  'Add it NOT VALID now (instant, enforced for new writes), then VALIDATE CONSTRAINT in a later migration ' +
  '(that step takes only SHARE UPDATE EXCLUSIVE and never flags).';

export const addFkWithoutNotValid: Rule = {
  id: 'add-fk-without-not-valid',
  severity: 'error',
  dialects: ['postgresql'],
  check(ctx: RuleContext): Finding[] {
    const findings: Finding[] = [];
    for (const { line, table, constraint } of addConstraintCommands(ctx)) {
      if (constraint.contype !== 'CONSTR_FOREIGN' || ctx.newTables.has(table)) {
        continue;
      }
      if (constraint.skip_validation === true) {
        continue; // declared NOT VALID — safe
      }
      findings.push(
        pgFinding(
          ctx,
          this.id,
          line,
          `Adding a foreign key to "${table}" without NOT VALID scans and locks both tables during validation.`,
          SUGGESTION,
        ),
      );
    }
    return findings;
  },
};
