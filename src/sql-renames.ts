import { parseTableRef, unquoteIdentifier } from './identifiers';
import type { SqlStatement } from './types';

// A table/column reference token: a run of non-space, non-semicolon chars
// (quoting and schema-qualification are unpacked afterward by the identifier
// helpers). Kept deliberately simple so the patterns stay linear-time.
const REF = String.raw`([^\s;]+)`;
const HEAD = String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?`;

const TABLE_RENAME = new RegExp(`${HEAD}${REF}\\s+RENAME\\s+TO\\s+${REF}\\s*;?\\s*$`, 'i');
const COLUMN_RENAME = new RegExp(
  `${HEAD}${REF}\\s+RENAME\\s+(?:COLUMN\\s+)?${REF}\\s+TO\\s+${REF}\\s*;?\\s*$`,
  'i',
);

export interface SqlTableRename {
  from: string;
  to: string;
  line: number;
}

export interface SqlColumnRename {
  table: string;
  from: string;
  to: string;
  line: number;
}

/** Matches a single statement against the table- then column-rename shapes.
 * Column rename is tried only when the table shape does not match, so
 * `RENAME TO` is never misread as a column rename. */
export function matchRename(
  statement: SqlStatement,
): SqlTableRename | SqlColumnRename | null {
  const table = TABLE_RENAME.exec(statement.text);
  if (table) {
    return { from: parseTableRef(table[1] as string), to: parseTableRef(table[2] as string), line: statement.line };
  }
  const column = COLUMN_RENAME.exec(statement.text);
  if (column) {
    return {
      table: parseTableRef(column[1] as string),
      from: unquoteIdentifier(column[2] as string),
      to: unquoteIdentifier(column[3] as string),
      line: statement.line,
    };
  }
  return null;
}

export function parseSqlRenames(statements: readonly SqlStatement[]): {
  tables: SqlTableRename[];
  columns: SqlColumnRename[];
} {
  const tables: SqlTableRename[] = [];
  const columns: SqlColumnRename[] = [];
  for (const statement of statements) {
    const rename = matchRename(statement);
    if (!rename) {
      continue;
    }
    // a column rename carries `table`; a table rename does not
    if ('table' in rename) {
      columns.push(rename);
    } else {
      tables.push(rename);
    }
  }
  return { tables, columns };
}
