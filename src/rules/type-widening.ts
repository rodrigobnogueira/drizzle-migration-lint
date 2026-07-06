import { firstTypmodInt, typeBaseName, type TypeName } from '../pg/nodes';

/** A type reduced to a canonical family + numeric modifiers, so a snapshot
 * string (`bigint`, `varchar(255)`) and an AST type (`int8`, `varchar`+typmod)
 * compare on equal footing. */
export interface CanonicalType {
  base: string;
  mods: number[];
}

/** pg spellings → canonical family. Anything unlisted keeps its own name, so
 * unknown types simply never match a widening pair. */
const BASE_ALIASES: Record<string, string> = {
  int2: 'int2',
  smallint: 'int2',
  int4: 'int4',
  int: 'int4',
  integer: 'int4',
  int8: 'int8',
  bigint: 'int8',
  varchar: 'varchar',
  'character varying': 'varchar',
  text: 'text',
  bpchar: 'bpchar',
  char: 'bpchar',
  character: 'bpchar',
  numeric: 'numeric',
  decimal: 'numeric',
  timestamp: 'timestamp',
  'timestamp without time zone': 'timestamp',
  timestamptz: 'timestamptz',
  'timestamp with time zone': 'timestamptz',
  time: 'time',
  'time without time zone': 'time',
  timetz: 'timetz',
  'time with time zone': 'timetz',
  varbit: 'varbit',
  'bit varying': 'varbit',
};

function canonicalBase(raw: string): string {
  const key = raw.trim().toLowerCase();
  return BASE_ALIASES[key] ?? key;
}

/** Parses a snapshot type string such as `varchar(255)`, `numeric(10, 2)`,
 * `bigint`, or `timestamp(3) with time zone`. */
export function parseSnapshotType(raw: string): CanonicalType {
  const paren = raw.indexOf('(');
  let baseText = raw;
  let mods: number[] = [];
  if (paren !== -1) {
    const close = raw.indexOf(')', paren);
    const inside = raw.slice(paren + 1, close === -1 ? raw.length : close);
    mods = inside
      .split(',')
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((value) => Number.isFinite(value));
    // keep any suffix after the parens (e.g. " with time zone")
    baseText = `${raw.slice(0, paren)}${close === -1 ? '' : raw.slice(close + 1)}`;
  }
  return { base: canonicalBase(baseText), mods };
}

/** Parses an AST TypeName. numeric carries two typmods (precision, scale);
 * everything else that we widen carries at most one. */
export function parseAstType(typeName: TypeName | undefined): CanonicalType | null {
  const name = typeBaseName(typeName);
  if (name === null) {
    return null;
  }
  const base = canonicalBase(name);
  const mods: number[] = [];
  const first = firstTypmodInt(typeName);
  if (first !== null) {
    mods.push(first);
    const second = typeName?.typmods?.[1]?.A_Const?.ival;
    if (second && typeof second === 'object' && 'ival' in second) {
      const value = (second as { ival?: unknown }).ival;
      if (typeof value === 'number') {
        mods.push(value);
      }
    }
  }
  return { base, mods };
}

/** `to` has no modifier ⇒ the widest form of its family (unlimited length /
 * default max precision), which is always ≥ any constrained `from`. */
function growsOrUnbounded(from: number | undefined, to: number | undefined): boolean {
  if (to === undefined) {
    return true;
  }
  return from !== undefined && to >= from;
}

/** True when `from → to` is a metadata-only change that never rewrites or
 * scans the table (handover §5 rule 2). */
export function isSafeWidening(from: CanonicalType, to: CanonicalType): boolean {
  if (from.base === 'varchar' && to.base === 'text') {
    return true;
  }
  if (from.base !== to.base) {
    return false;
  }
  switch (from.base) {
    case 'varchar':
    case 'varbit':
      return growsOrUnbounded(from.mods[0], to.mods[0]);
    case 'numeric':
      // precision may grow, scale must stay put; unconstrained target is widest
      return to.mods.length === 0 || (growsOrUnbounded(from.mods[0], to.mods[0]) && from.mods[1] === to.mods[1]);
    case 'timestamp':
    case 'timestamptz':
    case 'time':
    case 'timetz':
      return growsOrUnbounded(from.mods[0], to.mods[0]);
    default:
      return false;
  }
}
