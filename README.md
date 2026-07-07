# drizzle-migration-lint

Catch drizzle-kit migrations that will lock or rewrite your production tables — before they merge.

[Rails' strong_migrations](https://github.com/ankane/strong_migrations) has protected production databases from careless DDL for a decade. Nothing equivalent existed for [Drizzle](https://orm.drizzle.team): `drizzle-kit generate` happily emits `CREATE INDEX` (writes blocked for the whole build), `ALTER COLUMN ... TYPE` (full-table rewrite under `ACCESS EXCLUSIVE`), or `ADD COLUMN ... NOT NULL` with no default — and nothing warns you until production locks up.

`drizzle-migration-lint` is a standalone CLI that inspects the **artifacts drizzle-kit already generates** (migration SQL + snapshots) and flags operations that are unsafe to run against a live database, with the safe alternative spelled out in every message.

```
$ drizzle-migration-lint check
drizzle/0007_wide_havok.sql
  1  error  create-index-non-concurrently
      Creating an index on "orders" without CONCURRENTLY blocks all writes to the table for the entire build.
      → Build it with .concurrently() (CREATE INDEX CONCURRENTLY) AND move it to its own migration applied
        outside a transaction — drizzle wraps each migration in a transaction, where CONCURRENTLY fails.
      https://github.com/rodrigobnogueira/drizzle-migration-lint/blob/main/docs/rules.md#create-index-non-concurrently

1 error, 0 warnings (8 migrations checked)
```

## Why not just squawk?

[squawk](https://github.com/sbdchd/squawk) lints raw Postgres SQL and is excellent at it — but it has no idea what Drizzle knows. This tool reads drizzle-kit's **snapshots**, so it works from semantic diffs, not just text:

- Operations on tables **created in the same migration** are exempt — your bootstrap migration lints clean instead of producing a wall of false positives. No other tool has this.
- It understands both drizzle-kit artifact formats: the v1 per-migration folders (`<timestamp>_<name>/{migration.sql,snapshot.json}`) **and** the legacy journal layout (`meta/_journal.json` + `NNNN_*.sql`).

## How it compares

| | scope | drizzle-aware? | new-table exemption |
|---|---|---|---|
| **drizzle-migration-lint** | production-safety of generated migrations | yes (reads snapshots) | yes |
| `drizzle-kit check` | migrations that conflict with **each other** (parallel branches) | native | n/a |
| `drizzle-kit push` hints | live-DB data-loss prompts at push time | native | n/a — never sees migration files |
| squawk | raw Postgres SQL lint | no | no |
| Atlas | *replaces* drizzle-kit migrate; lints its own migration dirs | partial | no — can't read drizzle's dirs |

It **complements** `drizzle-kit check`: `check` catches migrations that conflict with each other; this catches migrations that conflict with uptime.

## Quick start

```sh
npx drizzle-migration-lint check          # lints the dir from your drizzle.config (or ./drizzle)
npx drizzle-migration-lint check --dir src/db/migrations
npx drizzle-migration-lint explain create-index-non-concurrently   # rule rationale + safe fix
```

Exit codes: `0` clean (or below `--fail-on` level), `1` findings, `2` usage/environment error.

## In CI

Use the GitHub Action — one step, inline PR annotations plus a job-summary table:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0            # --since needs history
- uses: rodrigobnogueira/drizzle-migration-lint@v0.2.0
  with:
    since: origin/${{ github.base_ref }}   # lint only what the PR adds
    fail-on: warn
```

Inputs: `dir`, `dialect`, `since`, `all`, `config`, `format` (default `github`), `fail-on` (default `error`), `version` (default `latest`). Or call it directly:

```yaml
- run: npx drizzle-migration-lint check --since origin/${{ github.base_ref }} --fail-on warn
```

`--since <git-ref>` reports only migrations added since the ref — so an unsafe migration merged long ago doesn't fail every new PR. A rewritten or squashed history fails safe (lints everything).

For **GitHub code scanning**, emit SARIF and upload it:

```yaml
- run: npx drizzle-migration-lint check --all --format sarif > results.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

## Rules

| Rule | Dialects | Severity |
|---|---|---|
| `create-index-non-concurrently` | postgres | error |
| `add-column-not-null-no-default` | postgres | error |
| `set-not-null` | postgres | error |
| `alter-column-type` (safe widenings whitelisted) | postgres | error |
| `add-fk-without-not-valid` | postgres | error |
| `add-check-without-not-valid` | postgres | error |
| `add-primary-key-on-existing-table` | postgres | error |
| `add-unique-constraint` | postgres | error |
| `volatile-default-on-add-column` | postgres | error |
| `add-enum-value` | postgres | warn |
| `drop-column` | all | warn |
| `drop-table` | all | warn |
| `rename-column` | all | warn |
| `rename-table` | all | warn |
| `truncate-in-migration` | postgres, mysql | warn |

Full rationale and the safe rewrite per rule: [docs/rules.md](docs/rules.md). Postgres is first-class (statement-level analysis via the real Postgres parser, `libpg-query`); sqlite and mysql get the structural (snapshot-diff) rules and are considered experimental.

## Configuration

Optional `.drizzle-migration-lint.json`:

```json
{
  "dir": "src/db/migrations",
  "baseline": { "tag": "0042_last_reviewed" },
  "rules": { "truncate-in-migration": "off", "drop-column": "error" },
  "introspect": { "url": "postgresql://…", "threshold": "16MB" }
}
```

- `rules` overrides any rule's severity, or turns it `off`.
- `introspect` opts into live table-size awareness (see below); omit it to stay fully offline.
- `baseline` (written by `drizzle-migration-lint baseline`) marks a migration as reviewed; later `check` runs skip everything up to and including it. Useful when adopting the tool on an existing project — baseline the current tip, then only new migrations are linted. `--all` overrides it.

## Suppressions

```sql
-- drizzle-migration-lint:disable-next-statement create-index-non-concurrently table is tiny and write-idle
CREATE INDEX "users_email_idx" ON "users" ("email");
```

`disable-file <rule-id>[,<rule-id>] [reason]` is also available. Suppressed findings stay visible in the summary counts.

## Table-size awareness (opt-in)

A lock or rewrite is only slow on a big table. Point the linter at a live Postgres and it will suppress lock/rewrite findings on tables at or below a size threshold — the lock is too brief to matter — so you only see the ones worth acting on:

```sh
npx drizzle-migration-lint check --db-url "$DATABASE_URL" --size-threshold 16MB
```

- **Opt-in and off by default** — without `--db-url` the tool never connects to anything.
- **Read-only:** one `SELECT` of `pg_total_relation_size` per table. It never writes, and never runs your migrations.
- Requires the `pg` package (an optional peer): `npm i pg`. If it can't connect, linting continues and a diagnostic notes that size-exemption was skipped.
- Only the eight **lock/rewrite** Postgres rules are eligible. Data-loss and rolling-deploy findings (drops, renames, truncate, `NOT NULL` without default) are never size-exempted — a small table doesn't make those safe.
- Suppressed findings stay visible (with the table's size noted). Configure via `introspect` in the config file, or `--size-threshold` (default `16MB`).

## Non-goals

- **Not a query linter.** For `.where()`/`.delete()` safety, see `eslint-plugin-drizzle`.
- **Never runs your migrations or executes your config** (`drizzle.config` is scanned with regexes, never imported). The default is fully offline; the *only* time it touches a database is the opt-in, read-only `--db-url` size query above.
- **No auto-rewrite.** Every finding tells you the safe recipe; applying it stays a human decision.
- **No runtime hooks.**

## License

MIT
