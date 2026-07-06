import type { PgExpr } from './nodes';

/** Functions that are re-evaluated per row, so a column default built from one
 * forces a full-table rewrite under ACCESS EXCLUSIVE (handover §5 rule 5). */
export const VOLATILE_FUNCTIONS: ReadonlySet<string> = new Set([
  'gen_random_uuid',
  'uuid_generate_v1',
  'uuid_generate_v1mc',
  'uuid_generate_v4',
  'random',
  'clock_timestamp',
  'timeofday',
  'nextval',
  'gen_random_bytes',
]);

/** Stable clock functions: PG 11+ stores a stable default without touching
 * existing rows, so these must NOT flag. `CURRENT_TIMESTAMP` parses as an
 * argument-less SQLValueFunction (no funcname) and is safe by construction;
 * `now()` parses as a FuncCall and needs this explicit allowlist. */
const STABLE_FUNCTIONS: ReadonlySet<string> = new Set([
  'now',
  'current_timestamp',
  'current_date',
  'current_time',
  'localtime',
  'localtimestamp',
  'statement_timestamp',
  'transaction_timestamp',
]);

export type DefaultVolatility =
  | { kind: 'safe' }
  | { kind: 'volatile'; fn: string }
  | { kind: 'unknown-fn'; fn: string };

function funcName(expr: PgExpr): string | null {
  const names = expr.FuncCall?.funcname;
  if (!names || names.length === 0) {
    return null;
  }
  return names[names.length - 1]?.String?.sval ?? null;
}

/** Classifies a column default expression. Constants and stable/known-safe
 * functions are `safe`; a known volatile function is `volatile`; any other
 * function call is `unknown-fn` (flagged with a softened message). */
export function classifyDefault(expr: PgExpr | undefined): DefaultVolatility {
  if (!expr) {
    return { kind: 'safe' };
  }
  const fn = funcName(expr);
  if (fn === null) {
    // SQLValueFunction (CURRENT_TIMESTAMP, ...) or a plain constant
    return { kind: 'safe' };
  }
  const lower = fn.toLowerCase();
  if (VOLATILE_FUNCTIONS.has(lower)) {
    return { kind: 'volatile', fn };
  }
  if (STABLE_FUNCTIONS.has(lower)) {
    return { kind: 'safe' };
  }
  return { kind: 'unknown-fn', fn };
}
