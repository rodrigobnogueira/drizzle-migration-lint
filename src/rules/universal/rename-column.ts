import { makeStructuralRule } from './structural';

export const renameColumn = makeStructuralRule('rename-column', 'rename-column', (op) => ({
  message: `Renaming column "${op.from}" to "${op.to}" on "${op.table}" has no safe rolling-deploy order — old code reads the old name, new code the new one.`,
  suggestion:
    'Add the new column, dual-write, backfill, switch reads, then drop the old column in a later migration.',
}));
