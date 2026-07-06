# Post-release validation

A repeatable runbook to validate **each published version** against a real
Postgres database. Run it after `vX.Y.Z` publishes to npm, before relying on or
announcing the release.

It complements [release-smoke.md](release-smoke.md): that one runs *before*
tagging, against a packed tarball. This one runs *after publishing*, against the
**actual npm package**, and adds a real database so the safety claims are
verified against Postgres behavior — a flagged migration must genuinely break,
and a passed one must genuinely apply.

## Why a real database

Unit tests (100% coverage) validate the engine against fixture artifacts. They
cannot prove three things that only matter in production:

1. **`libpg-query` loads from a clean install** of the published tarball (the
   WASM asset ships and initializes on a fresh machine).
2. **The findings correspond to reality** — the tool claims a migration will
   lock or fail; that is only trustworthy if the same migration actually fails
   against Postgres, and the "safe" alternative actually applies.
3. **The published artifact === what we tested** (the `files` allowlist, the bin
   wiring, dir/dialect resolution from a real config).

## Prerequisites

- Docker (a throwaway container — nothing touches your real databases).
- Node ≥ 20.
- The version under test, e.g. `VER=0.1.1`.

## 0. Throwaway Postgres

```sh
docker run -d --name dml-verify-pg \
  -e POSTGRES_USER=dml -e POSTGRES_PASSWORD=dml -e POSTGRES_DB=dml \
  -p 55432:5432 postgres:16-alpine
until docker exec dml-verify-pg pg_isready -U dml -d dml >/dev/null 2>&1; do sleep 1; done
PSQL="docker exec -i dml-verify-pg psql -U dml -d dml -v ON_ERROR_STOP=1"
DB=postgresql://dml:dml@127.0.0.1:55432/dml
```

## 1. Install the PUBLISHED package (never a local checkout)

```sh
mkdir dml-verify && cd dml-verify && npm init -y >/dev/null
npm i "drizzle-migration-lint@$VER" drizzle-orm@1.0.0-rc.4 drizzle-kit@1.0.0-rc.4 pg
BIN=./node_modules/.bin/drizzle-migration-lint
# libpg-query must come along as the ONLY runtime dep
node -e "console.log('dml', require('drizzle-migration-lint/package.json').version, '| libpg-query', require('libpg-query/package.json').version)"
```

## 2. Generate real migrations (v1 folder format)

`drizzle.config.ts` → `{ schema: './schema.ts', out: './migrations', dialect: 'postgresql', dbCredentials: { url: DB } }`.

Generate three steps by swapping `schema.ts` and running
`drizzle-kit generate --name <step>` each time:

- **`init`** — bootstrap: `users` (with an index) + `posts` (with an FK).
  Everything is new → **must lint clean**.
- **`evolve`** — on the now-existing tables: `ADD COLUMN bio text NOT NULL`
  (no default), `age integer → bigint`, a non-`CONCURRENTLY` index on `posts`;
  plus a `code varchar(10) → varchar(20)` widening and a brand-new `comments`
  table. **Must flag** the first three; **must NOT flag** the widening or
  anything on `comments`.
- **`safe`** — `ADD COLUMN nickname text` (nullable), `ADD COLUMN status text
  NOT NULL DEFAULT 'active'` (constant default), `CREATE INDEX CONCURRENTLY`.
  **Must lint clean.**

> Keep drops and adds in separate migrations — combining them makes
> `drizzle-kit generate` prompt interactively about renames.

Optionally add a fourth step exercising the remaining rules (adds-only, to
avoid the rename prompt): a `uuid` column defaulting to `gen_random_uuid()`
(volatile default), a nullable column made `NOT NULL` (set-not-null), a new FK
and a `CHECK` on existing tables — then a drop-only migration for `drop-column`.

## 3. Lint — assert the findings

```sh
$BIN check --all --format json
```

- [ ] No `pg-parser-unavailable` diagnostic (proves `libpg-query` loaded).
- [ ] `init`: **0 findings**.
- [ ] `evolve`: exactly `add-column-not-null-no-default`, `alter-column-type`,
      `create-index-non-concurrently`, each at the expected line; the widening
      and `comments` operations absent.
- [ ] `safe`: **0 findings**.
- [ ] Exit code `1` when errors exist, `0` when clean.

## 4. Prove the findings match Postgres reality

```sh
$PSQL -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
$PSQL -q --single-transaction < migrations/*_init/migration.sql          # applies clean
$PSQL -q -c "INSERT INTO users (email,name) VALUES ('a@x','A'),('b@x','B');"
$PSQL -q --single-transaction < migrations/*_evolve/migration.sql        # EXPECT FAILURE
```

- [ ] Applying `evolve` on the **populated** table fails with
      `column "bio" ... contains null values` — the flagged migration really
      does break production.
- [ ] The **safe** adds apply on the populated table:
      `ALTER TABLE users ADD COLUMN nickname text;` and
      `ADD COLUMN status text DEFAULT 'x' NOT NULL;` both succeed.
- [ ] `CREATE INDEX CONCURRENTLY ...` fails inside a transaction
      (`--single-transaction`) with *"cannot run inside a transaction block"*,
      and succeeds without one — validating the two-part `create-index` advice
      (drizzle's migrator wraps each migration in a transaction).

## 5. Legacy artifact format (drizzle-kit ≤ 0.31.x)

Repeat steps 2–3 in a second project with
`npm i drizzle-kit@0.31.10 drizzle-orm@0.45.2` (out dir `./drizzle`). The
layout is the journal format (`meta/_journal.json` + `NNNN_*.sql`).

- [ ] Auto-detected; same rules flag on `0001_evolve` (line numbers differ from
      v1 — the generated SQL is formatted differently).

## 6. CLI surface

- [ ] Reporters: `--format pretty` (grouped, colored, `NO_COLOR` honored),
      `--format json` (`{version:1,...}`), `--format github` (`::error` lines +
      a table appended to `$GITHUB_STEP_SUMMARY`).
- [ ] Config `.drizzle-migration-lint.json` `rules` overrides remap/`off` a
      rule's severity; verify the exit code follows.
- [ ] Suppressions: `-- drizzle-migration-lint:disable-next-statement <id>` and
      `disable-file` move a finding to the suppressed count (still visible).
- [ ] `--fail-on error|warn|none` changes the exit code accordingly.
- [ ] `--since <git-ref>` reports only migrations added since the ref (older
      findings excluded); `baseline` writes the `baseline` key and later `check`
      skips up to it.
- [ ] With no `--dir`, the migrations dir resolves from `drizzle.config.ts`.

## 7. Robustness

- [ ] A hand-edited/malformed migration → a `pg-statements-unparsed` diagnostic
      (scoped to that migration), no crash, and the rest of the history still
      linted.
- [ ] Empty migrations dir → `0` migrations checked, no crash.
- [ ] Non-existent `--dir` → exit code `2`.
- [ ] `--version` prints `VER`; `--help` prints usage.

## 8. Teardown

```sh
docker rm -f dml-verify-pg
```

## Sign-off

A release passes when every box above is checked. Record the version, date, and
any deviations. If a box fails, open a fix PR (branch → PR → green CI → merge),
cut a patch, and re-run this runbook against the new version — `0.1.1` itself
was cut this way, after this runbook surfaced the silent-skip gap now covered
in step 7.
