import { makeStructuralRule } from './structural';

export const dropTable = makeStructuralRule('drop-table', 'drop-table', (op) => ({
  message: `Dropping table "${op.table}" breaks any still-deployed application version that reads it.`,
  suggestion:
    'Stop reading the table in code and deploy everywhere first, then drop it in a later migration.',
}));
