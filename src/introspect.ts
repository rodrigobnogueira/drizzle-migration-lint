import { tableIdentity } from './identifiers';

export interface SizeRow {
  schema: string;
  name: string;
  /** pg returns bigint as a string; a number is accepted too (test seams). */
  bytes: string | number;
}

export interface PgClientLike {
  query(sql: string): Promise<{ rows: SizeRow[] }>;
  end(): Promise<void>;
}

interface RawPgClient extends PgClientLike {
  connect(): Promise<void>;
}

export type PgConnector = (url: string) => Promise<PgClientLike>;

/** On-disk size per ordinary table. Partitioned tables (`relkind 'p'`) are
 * excluded on purpose: `pg_total_relation_size` reports only the empty parent,
 * so they'd look tiny — leaving them out keeps them un-exempted (conservative). */
const SIZE_QUERY =
  'SELECT n.nspname AS schema, c.relname AS name, pg_total_relation_size(c.oid) AS bytes ' +
  'FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ' +
  "WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')";

/** Lazy pg import: `pg` is an optional peer, installed only for introspection. */
/* c8 ignore start -- the real pg connection is covered by an injected connector
   in unit tests and by the live Docker Postgres in post-release validation */
const defaultConnector: PgConnector = async (url) => {
  type PgModule = { Client: new (config: unknown) => RawPgClient };
  let pg: PgModule;
  try {
    // `pg` is an optional peer — a non-literal specifier keeps it out of the build graph
    pg = (await import('pg' as string)) as unknown as PgModule;
  } catch {
    throw new Error("the 'pg' package is required for live table sizes; install it with `npm i pg`");
  }
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
  });
  await client.connect();
  return client;
};
/* c8 ignore stop */

export type IntrospectResult = { sizes: Map<string, number> } | { error: string };

/** Reads on-disk table sizes from a live Postgres — read-only, one query.
 * Returns `{ error }` on any failure so the caller can degrade with a
 * diagnostic rather than failing the lint. */
/** Closes the throwaway connection, swallowing any close error. */
async function closeQuietly(client: PgClientLike | undefined): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.end();
  } catch {
    // ignore errors while closing the throwaway connection
  }
}

export async function introspectTableSizes(
  url: string,
  connector: PgConnector = defaultConnector,
): Promise<IntrospectResult> {
  let client: PgClientLike | undefined;
  try {
    client = await connector(url);
    const { rows } = await client.query(SIZE_QUERY);
    const sizes = new Map<string, number>();
    for (const row of rows) {
      const schema = row.schema === 'public' ? null : row.schema;
      sizes.set(tableIdentity(schema, row.name), Number(row.bytes));
    }
    await closeQuietly(client);
    return { sizes };
  } catch (error) {
    await closeQuietly(client);
    return { error: (error as Error).message };
  }
}
