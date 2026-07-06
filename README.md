# drizzle-migration-lint

Catch drizzle-kit migrations that will lock or rewrite your production tables — before they merge.

> **Status: pre-release.** The v0.1.0 rule catalog and CLI are under active development; the sections below describe the shipping design. Until v0.1.0 is tagged, expect churn.

[Rails' strong_migrations](https://github.com/ankane/strong_migrations) has protected production databases from careless DDL for a decade. Nothing equivalent exists for [Drizzle](https://orm.drizzle.team): `drizzle-kit generate` happily emits `CREATE INDEX` (table writes blocked for the whole build), `ALTER COLUMN ... TYPE` (full-table rewrite under `ACCESS EXCLUSIVE`), or `ADD COLUMN ... NOT NULL` with no default — and nothing warns you until production locks up.

`drizzle-migration-lint` is a standalone CLI that inspects the **artifacts drizzle-kit already generates** (migration SQL + snapshots) and flags operations that are unsafe to run against a live database, with the safe alternative spelled out in every message.

## Why not just squawk?

[squawk](https://github.com/sbdchd/squawk) lints raw Postgres SQL and is excellent at it — but it has no idea what Drizzle knows. This tool reads drizzle-kit's **snapshots**, so it knows whether a table already existed before this migration:

- Operations on tables **created in the same migration** are exempt — your bootstrap migration lints clean instead of producing a wall of false positives.
- It understands both drizzle-kit artifact formats: the v1 per-migration folders (`<timestamp>_<name>/{migration.sql,snapshot.json}`) **and** the legacy journal layout (`meta/_journal.json` + `NNNN_*.sql`).
- It complements `drizzle-kit check`: `check` catches migrations that conflict with **each other**; this catches migrations that conflict with **uptime**.

## Quick start

```sh
npx drizzle-migration-lint check          # lints ./drizzle (or dir from your drizzle.config)
npx drizzle-migration-lint check --all --dir src/db/migrations --format github
```

Exit codes: `0` clean (or below `--fail-on` level), `1` findings, `2` usage/environment error.

## Rules (v0.1 catalog)

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

Full rationale and safe alternatives per rule: [docs/rules.md](docs/rules.md).

Postgres is first-class (statement-level analysis through the real Postgres parser); sqlite and mysql get the structural (snapshot-diff) rules and are considered experimental.

## Suppressions

```sql
-- drizzle-migration-lint:disable-next-statement create-index-non-concurrently table is tiny and write-idle
CREATE INDEX "users_email_idx" ON "users" ("email");
```

`disable-file <rule-id>[,<rule-id>] [reason]` is also available. Suppressed findings stay visible in the summary counts.

## Non-goals

- Not a query linter (see `eslint-plugin-drizzle` for that).
- Never executes your migrations, your config, or your database — it only reads generated files.
- No auto-rewrite of unsafe SQL: every finding tells you the safe recipe; applying it stays a human decision.
- No live-database introspection (table sizes etc.) in v0.1.

## License

MIT
