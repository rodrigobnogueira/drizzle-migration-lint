# Rules

Every rule message links back to its section here. Anchors are stable API — do not rename headings.

Severity defaults: `error` fails the run (exit 1) under the default `--fail-on error`; `warn` is reported but only fails under `--fail-on warn`. Both can be overridden per rule in `.drizzle-migration-lint.json` (`"rules": { "<id>": "off" | "warn" | "error" }`).

**The new-table exemption applies to every rule:** operations on a table that is *created in the same migration* are always safe (nobody can be reading it yet) and never flagged. This is what reading drizzle-kit's snapshots buys over linting raw SQL.

---

## create-index-non-concurrently

**Flags:** `CREATE [UNIQUE] INDEX` without `CONCURRENTLY` on a pre-existing table (postgres, error).

**Why:** a plain `CREATE INDEX` takes a `SHARE` lock — every `INSERT`/`UPDATE`/`DELETE` on the table blocks for the entire index build. On a large table that is minutes of write downtime.

**Safe alternative — two halves, both required:**

1. Use `.concurrently()` in your Drizzle schema (or `CREATE INDEX CONCURRENTLY` in custom SQL).
2. Move it to **its own migration applied outside a transaction**. Drizzle's migrator wraps each migration in a transaction, and `CREATE INDEX CONCURRENTLY` cannot run inside one — it fails with `25001`. Recipe: create a separate migration with `drizzle-kit generate --custom`, and apply it with a runner step that disables the wrapping transaction.

**Does not fire when:** the table is new in this migration, or the index is already `CONCURRENTLY`.

## add-column-not-null-no-default

**Flags:** `ADD COLUMN ... NOT NULL` without a `DEFAULT` on a pre-existing table (postgres, error).

**Why:** every existing row violates the constraint the instant it lands — the statement fails on any non-empty table, usually mid-deploy.

**Safe alternative:** add the column nullable → backfill in batches → then apply [set-not-null](#set-not-null)'s three-step. Or, if a constant default is acceptable, `ADD COLUMN ... NOT NULL DEFAULT <constant>` is safe and rewrite-free on PG 11+.

## set-not-null

**Flags:** `ALTER COLUMN ... SET NOT NULL` on a pre-existing table (postgres, error).

**Why:** it takes `ACCESS EXCLUSIVE` and scans the whole table to verify no NULLs while everything else waits.

**Safe alternative (PG 12+):**

1. `ALTER TABLE t ADD CONSTRAINT t_col_nn CHECK (col IS NOT NULL) NOT VALID;` — instant.
2. `ALTER TABLE t VALIDATE CONSTRAINT t_col_nn;` — takes only a `SHARE UPDATE EXCLUSIVE` lock; writes continue.
3. `ALTER TABLE t ALTER COLUMN col SET NOT NULL;` — PG sees the validated constraint and **skips the scan**.
4. Optionally drop the now-redundant check constraint.

## alter-column-type

**Flags:** `ALTER COLUMN ... TYPE` on a pre-existing table, unless the change is on the safe-widening whitelist (postgres, error).

**Why:** most type changes rewrite the entire table under `ACCESS EXCLUSIVE` — reads *and* writes block for the duration.

**Whitelisted as safe (metadata-only):** `varchar(n) → varchar(m≥n)`, `varchar(n) → text`, `numeric(p,s) → numeric(p2≥p,s)` or unqualified `numeric`, precision widenings of `time`/`timetz`/`timestamp`/`timestamptz`, `bit varying(n) → bit varying(m≥n)`.

**Traps called out in messages:** `int4 → int8` rewrites the table; `text → varchar(n)` scans; `timestamp → timestamptz` rewrites unless the server timezone is UTC (PG 12+). A `USING` clause forces whole-table evaluation.

**Safe alternative for rewriting changes:** new column → dual-write → backfill → switch reads → drop old column (see [drop-column](#drop-column)).

## add-fk-without-not-valid

**Flags:** `ADD CONSTRAINT ... FOREIGN KEY` without `NOT VALID` when the table pre-exists (postgres, error).

**Why:** validation scans both tables while holding locks on both.

**Safe alternative:** `ADD CONSTRAINT ... FOREIGN KEY ... NOT VALID` now (instant, enforced for new writes) → `VALIDATE CONSTRAINT` in a later migration (`SHARE UPDATE EXCLUSIVE` only). The `VALIDATE CONSTRAINT` step itself never flags.

## add-check-without-not-valid

**Flags:** `ADD CONSTRAINT ... CHECK` without `NOT VALID` on a pre-existing table (postgres, error).

**Why / safe alternative:** same shape as [add-fk-without-not-valid](#add-fk-without-not-valid) — add `NOT VALID`, validate later.

## add-primary-key-on-existing-table

**Flags:** `ADD CONSTRAINT ... PRIMARY KEY` on a pre-existing table, unless it attaches via `USING INDEX` (postgres, error).

**Why:** building the underlying unique index inline holds `ACCESS EXCLUSIVE` for the whole build.

**Safe alternative:** `CREATE UNIQUE INDEX CONCURRENTLY` in its own out-of-transaction migration (see [create-index-non-concurrently](#create-index-non-concurrently)), then `ADD CONSTRAINT ... PRIMARY KEY USING INDEX <idx>` — instant.

## add-unique-constraint

**Flags:** `ADD CONSTRAINT ... UNIQUE (...)` on a pre-existing table, unless it attaches via `USING INDEX` (postgres, error).

**Why:** the constraint builds its backing unique index inline, holding `ACCESS EXCLUSIVE` for the whole build — every read and write to the table blocks.

**Safe alternative:** `CREATE UNIQUE INDEX CONCURRENTLY` in its own out-of-transaction migration (see [create-index-non-concurrently](#create-index-non-concurrently)), then `ADD CONSTRAINT ... UNIQUE USING INDEX <idx>` — which attaches instantly.

## volatile-default-on-add-column

**Flags:** `ADD COLUMN ... DEFAULT <volatile-function>()` on a pre-existing table (postgres, error).

**Why:** PG 11+ stores constant *and stable* defaults without touching existing rows — but a **volatile** default (`gen_random_uuid`, `uuid_generate_v4`, `random`, `clock_timestamp`, `timeofday`, `nextval`, `gen_random_bytes`, ...) must be evaluated per row: full-table rewrite under `ACCESS EXCLUSIVE`.

**Deliberate stance:** `now()` / `CURRENT_TIMESTAMP` are **STABLE, not volatile — they do not flag.** The folk rule that says otherwise predates PG 11. Unknown function names flag with a softened "cannot verify volatility" message.

**Safe alternative:** add the column with no default (or a constant), set the volatile default afterwards (applies to new rows only), backfill existing rows in batches.

## add-enum-value

**Flags:** `ALTER TYPE ... ADD VALUE` (postgres, warn).

**Why:** drizzle wraps each migration in a transaction, and `ADD VALUE` is restricted there — on PostgreSQL < 12 it cannot run inside a transaction at all (the migration fails), and on 12+ the newly added value cannot be used until the transaction commits, so any statement in the *same* migration that references the new value fails. drizzle-kit emits `ADD VALUE` only against a pre-existing enum. (This is a `warn`: a standalone `ADD VALUE` on PG 12+ is fine — the risk is version- and usage-dependent.)

**Safe alternative:** put the `ADD VALUE` in its own migration, and don't use the new value (as a default, in an `UPDATE`, etc.) until a later one.

> `RENAME VALUE` is not flagged. Removing an enum value is a different operation: drizzle rebuilds the column type, which surfaces as [alter-column-type](#alter-column-type).

## drop-column

**Flags:** dropping a column from a pre-existing table (all dialects, warn).

**Why:** any still-deployed application version that selects the column starts failing the moment the migration applies — classic rolling-deploy breakage. On sqlite it also forces a table rebuild.

**Safe sequence:** stop reading the column in code → deploy everywhere → then drop in a later migration.

## drop-table

**Flags:** dropping a pre-existing table (all dialects, warn).

**Why / safe sequence:** same rolling-deploy hazard as [drop-column](#drop-column), table-sized.

## rename-column

**Flags:** renaming a column on a pre-existing table (all dialects, warn).

**Why:** old code reads the old name, new code the new one — there is no deploy order that works with a bare rename.

**Safe sequence (strong_migrations-style):** add new column → dual-write → backfill → switch reads → drop old column later.

## rename-table

**Flags:** renaming a pre-existing table (all dialects, warn).

**Safe sequence:** as [rename-column](#rename-column); a temporary updatable view with the old name can bridge the transition.

## truncate-in-migration

**Flags:** any `TRUNCATE` statement in a migration (postgres + mysql, warn).

**Why:** `TRUNCATE` takes `ACCESS EXCLUSIVE` (postgres) and destroys data as a side effect of schema deployment; on mysql it commits implicitly. Data destruction hiding inside a migrations directory is almost never intended to run against production.

**Safe alternative:** if the truncate is deliberate, move it to an explicit operational script or data task — or suppress with a reason: `-- drizzle-migration-lint:disable-next-statement truncate-in-migration <why>`.
