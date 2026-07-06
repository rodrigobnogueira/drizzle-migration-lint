/** Strips one layer of SQL identifier quoting: "x" (pg/sqlite), `x` (mysql),
 * [x] (mssql). */
export function unquoteIdentifier(raw: string): string {
  const trimmed = raw.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if (
    (first === '"' && last === '"') ||
    (first === '`' && last === '`') ||
    (first === '[' && last === ']')
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Normalized table identity used everywhere (snapshots, rules): bare name
 * for the default/only schema, `schema.name` otherwise. Mirrors drizzle-kit's
 * own record-key convention for pg snapshots. */
export function tableIdentity(schema: string | undefined | null, name: string): string {
  if (!schema || schema === 'public') {
    return name;
  }
  return `${schema}.${name}`;
}

/** Parses a (possibly quoted, possibly schema-qualified) table reference from
 * SQL text into a normalized identity. */
export function parseTableRef(ref: string): string {
  const cleaned = ref.trim().replace(/\*$/, '').trim();
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of cleaned) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
      current += ch;
    } else if (ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
    } else if (ch === '.') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  const names = parts.map(unquoteIdentifier).filter((part) => part.length > 0);
  if (names.length >= 2) {
    return tableIdentity(names[names.length - 2], names[names.length - 1] as string);
  }
  return tableIdentity(null, names[0] ?? '');
}
