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
```

Exit codes: `0` clean (or below `--fail-on` level), `1` findings, `2` usage/environment error.

## In CI

Under GitHub Actions the output defaults to inline annotations plus a job-summary table. Lint only what a PR adds with `--since`:

```yaml
- run: npx drizzle-migration-lint check --since origin/${{ github.base_ref }} --fail-on warn
```

`--since <git-ref>` reads the migration set at that ref and reports only migrations added since — so an unsafe migration merged long ago doesn't fail every new PR. A rewritten or squashed history fails safe (lints everything).

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
| `volatile-default-on-add-column` | postgres | error |
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
  "rules": { "truncate-in-migration": "off", "drop-column": "error" }
}
```

- `rules` overrides any rule's severity, or turns it `off`.
- `baseline` (written by `drizzle-migration-lint baseline`) marks a migration as reviewed; later `check` runs skip everything up to and including it. Useful when adopting the tool on an existing project — baseline the current tip, then only new migrations are linted. `--all` overrides it.

## Suppressions

```sql
-- drizzle-migration-lint:disable-next-statement create-index-non-concurrently table is tiny and write-idle
CREATE INDEX "users_email_idx" ON "users" ("email");
```

`disable-file <rule-id>[,<rule-id>] [reason]` is also available. Suppressed findings stay visible in the summary counts.

## Non-goals

- **Not a query linter.** For `.where()`/`.delete()` safety, see `eslint-plugin-drizzle`.
- **Never executes anything.** It reads generated files only — it does not run your migrations, import your `drizzle.config` (that's scanned with regexes), or connect to a database.
- **No auto-rewrite.** Every finding tells you the safe recipe; applying it stays a human decision.
- **No runtime hooks** and no live-database introspection (table sizes, etc.) in v0.1.

## License

MIT
