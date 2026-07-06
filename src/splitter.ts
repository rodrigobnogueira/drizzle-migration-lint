import type { SqlStatement } from './types';

/** drizzle-kit's statement separator — identical in the legacy and v1
 * formats. It appears both on its own line and appended to a statement's
 * last line (`...);--> statement-breakpoint`), so files are split on the
 * token, never on lines. */
export const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

function lineAt(sql: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (sql[i] === '\n') {
      line += 1;
    }
  }
  return line;
}

/** Splits a migration file into statements, keeping the 1-based line where
 * each statement starts. Files generated without breakpoints yield a single
 * statement. */
export function splitStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let cursor = 0;
  for (;;) {
    const tokenIndex = sql.indexOf(STATEMENT_BREAKPOINT, cursor);
    const end = tokenIndex === -1 ? sql.length : tokenIndex;
    const piece = sql.slice(cursor, end);
    const text = piece.trim();
    if (text.length > 0) {
      const leading = piece.length - piece.trimStart().length;
      statements.push({ text, line: lineAt(sql, cursor + leading) });
    }
    if (tokenIndex === -1) {
      return statements;
    }
    cursor = tokenIndex + STATEMENT_BREAKPOINT.length;
  }
}
