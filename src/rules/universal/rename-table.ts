import { makeStructuralRule } from './structural';

export const renameTable = makeStructuralRule('rename-table', 'rename-table', (op) => ({
  message: `Renaming table "${op.from}" to "${op.to}" has no safe rolling-deploy order — old code reads the old name, new code the new one.`,
  suggestion:
    `Add the new table, dual-write, backfill, switch reads, then drop the old one in a later migration — or bridge the transition with an updatable view named "${op.from}".`,
}));
