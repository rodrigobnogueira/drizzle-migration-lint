import type { PgParseFn } from './ast';
import type { PgStatement } from './nodes';

/** 1-based line of a byte offset: count newlines before it. drizzle-kit
 * migrations are ASCII/UTF-8 where the SQL keywords are single-byte, so a
 * character scan of that prefix matches the byte offset for our purposes. */
export function byteOffsetToLine(sql: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, sql.length);
  for (let i = 0; i < end; i += 1) {
    if (sql[i] === '\n') {
      line += 1;
    }
  }
  return line;
}

/** pg_query reports a statement's `stmt_location` as the offset right after the
 * previous statement's terminator, which for drizzle files lands on the
 * `--> statement-breakpoint` comment. Advance past leading whitespace and `--`
 * line comments to the first real token so the line points at the statement. */
export function statementStart(sql: string, offset: number): number {
  let i = Math.min(Math.max(offset, 0), sql.length);
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const newline = sql.indexOf('\n', i);
      if (newline === -1) {
        return sql.length;
      }
      i = newline + 1;
    } else {
      break;
    }
  }
  return i;
}

/** Parses a whole migration file into top-level statements with resolved
 * lines. `--> statement-breakpoint` is a SQL comment, so the parser eats the
 * entire file in one call. Returns [] if the parse yields nothing. */
export function extractPgStatements(parse: PgParseFn, sql: string): PgStatement[] {
  const result = parse(sql);
  const statements: PgStatement[] = [];
  for (const raw of result.stmts ?? []) {
    const kind = Object.keys(raw.stmt)[0];
    if (kind === undefined) {
      continue;
    }
    statements.push({
      kind,
      node: raw.stmt[kind] as Record<string, unknown>,
      line: byteOffsetToLine(sql, statementStart(sql, raw.stmt_location ?? 0)),
    });
  }
  return statements;
}
