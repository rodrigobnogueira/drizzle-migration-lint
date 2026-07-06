import { makeStructuralRule } from './structural';

export const dropColumn = makeStructuralRule('drop-column', 'drop-column', (op) => ({
  message: `Dropping column "${op.column}" from "${op.table}" breaks any still-deployed application version that selects it.`,
  suggestion:
    'Stop selecting the column in code and deploy everywhere first, then drop it in a later migration.',
}));
