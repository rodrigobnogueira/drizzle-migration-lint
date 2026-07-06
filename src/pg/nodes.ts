/** Minimal typed views of the libpg-query (pg_query) proto3 JSON AST — only
 * the fields the rules read. proto3 semantics: an absent field means the
 * default (false / unset), so every optional below must be tested for
 * PRESENCE, never compared `=== false`. */

export interface StringNode {
  String?: { sval?: string };
}

export interface PgExpr {
  FuncCall?: { funcname?: StringNode[] };
  SQLValueFunction?: { op?: string };
  A_Const?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TypeName {
  names?: StringNode[];
  typmods?: PgExpr[];
}

export interface Constraint {
  contype?: string;
  /** present ⇔ the constraint was declared NOT VALID */
  skip_validation?: boolean;
  /** present ⇔ PRIMARY KEY / UNIQUE ... USING INDEX <name> */
  indexname?: string;
  raw_expr?: PgExpr;
}

export interface ColumnDef {
  colname?: string;
  typeName?: TypeName;
  constraints?: { Constraint?: Constraint }[];
  /** pg_query quirk: for AT_AlterColumnType the USING expression lands here */
  raw_default?: PgExpr;
}

export interface RangeVar {
  relname?: string;
  schemaname?: string;
}

export interface AlterTableCmd {
  subtype?: string;
  /** the column name for AT_SetNotNull / AT_AlterColumnType */
  name?: string;
  def?: { ColumnDef?: ColumnDef; Constraint?: Constraint };
}

export interface AlterTableStmt {
  relation?: RangeVar;
  cmds?: { AlterTableCmd?: AlterTableCmd }[];
}

export interface IndexStmt {
  relation?: RangeVar;
  unique?: boolean;
  /** present ⇔ CREATE INDEX CONCURRENTLY */
  concurrent?: boolean;
  whereClause?: PgExpr;
}

export interface RawStmt {
  stmt: Record<string, unknown>;
  /** byte offset of the statement start; absent (⇒ 0) for the first one */
  stmt_location?: number;
  stmt_len?: number;
}

export interface ParseResult {
  stmts?: RawStmt[];
  version?: number;
}

/** One parsed top-level statement, with its 1-based start line resolved from
 * the byte offset. `node` is the unwrapped inner node (the value under its
 * single `<Kind>` key). */
export interface PgStatement {
  kind: string;
  node: Record<string, unknown>;
  line: number;
}

export function typeBaseName(typeName: TypeName | undefined): string | null {
  const names = typeName?.names;
  if (!names || names.length === 0) {
    return null;
  }
  // the last segment is the type; a leading `pg_catalog` schema is dropped
  const last = names[names.length - 1];
  return last?.String?.sval ?? null;
}

/** First integer typmod (e.g. the `n` in `varchar(n)`), or null. */
export function firstTypmodInt(typeName: TypeName | undefined): number | null {
  const first = typeName?.typmods?.[0];
  const ival = first?.A_Const?.ival;
  if (ival && typeof ival === 'object' && 'ival' in ival) {
    const value = (ival as { ival?: unknown }).ival;
    return typeof value === 'number' ? value : null;
  }
  return null;
}

export function constraintsOf(columnDef: ColumnDef | undefined): Constraint[] {
  return (columnDef?.constraints ?? [])
    .map((wrap) => wrap.Constraint)
    .filter((constraint): constraint is Constraint => constraint !== undefined);
}
