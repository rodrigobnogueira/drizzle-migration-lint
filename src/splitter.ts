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

/** Offset within `piece` of the first line that is neither blank nor a `--`
 * line comment — i.e. where the SQL body actually begins. Leading comments
 * (including suppression directives) are skipped so the anchored rule/differ
 * regexes see real SQL, and `.line` points at the statement, not its comment. */
function sqlBodyOffset(piece: string): number {
  let offset = 0;
  while (offset < piece.length) {
    const newline = piece.indexOf('\n', offset);
    const lineEnd = newline === -1 ? piece.length : newline;
    const line = piece.slice(offset, lineEnd);
    const trimmedStart = line.length - line.trimStart().length;
    const content = line.trim();
    if (content.length > 0 && !content.startsWith('--')) {
      return offset + trimmedStart;
    }
    if (newline === -1) {
      return piece.length;
    }
    offset = newline + 1;
  }
  return piece.length;
}

/** Splits a migration file into statements, keeping the 1-based line where
 * each statement's SQL starts (leading blank/comment lines skipped). Files
 * generated without breakpoints yield a single statement. */
export function splitStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let cursor = 0;
  for (;;) {
    const tokenIndex = sql.indexOf(STATEMENT_BREAKPOINT, cursor);
    const end = tokenIndex === -1 ? sql.length : tokenIndex;
    const piece = sql.slice(cursor, end);
    const bodyOffset = sqlBodyOffset(piece);
    const text = piece.slice(bodyOffset).trim();
    if (text.length > 0) {
      statements.push({ text, line: lineAt(sql, cursor + bodyOffset) });
    }
    if (tokenIndex === -1) {
      return statements;
    }
    cursor = tokenIndex + STATEMENT_BREAKPOINT.length;
  }
}
