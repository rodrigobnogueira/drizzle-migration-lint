# Changelog

## 0.2.0 — 2026-07-06

- New Postgres rules: `add-unique-constraint` (a `UNIQUE` constraint builds its
  index under `ACCESS EXCLUSIVE` — error; use `CREATE UNIQUE INDEX CONCURRENTLY`
  + `ADD CONSTRAINT ... USING INDEX`) and `add-enum-value` (`ALTER TYPE ... ADD
  VALUE` is restricted inside drizzle's per-migration transaction — warn).
- `--format sarif`: SARIF 2.1.0 output for GitHub code scanning
  (`github/codeql-action/upload-sarif`).
- `explain <rule-id>` command: prints a rule's rationale and safe alternative.
- A reusable GitHub composite Action —
  `uses: rodrigobnogueira/drizzle-migration-lint@v0.2.0`.

## 0.1.1 — 2026-07-06

- Emit a `pg-statements-unparsed` diagnostic (scoped to the migration) when the
  Postgres parser cannot read a migration's SQL, instead of silently skipping
  its statement-level rules. A partly-unchecked migration no longer reads as
  clean. Structural rules still run.
- Add `docs/post-release-validation.md`: a real-database runbook to validate
  each published version (the process that surfaced the fix above).

## 0.1.0 — 2026-07-06

First release.

- Dual-format reader for drizzle-kit artifacts: the v1 per-migration folder
  layout (v8 flat-DDL snapshots, `prevIds` DAG) and the legacy journal layout
  (pg v7 / sqlite v6 / mysql v5 snapshots).
- Snapshot-diff engine with a new-table exemption: operations on tables
  created in the same migration never flag.
- Structural rules (all dialects): `drop-column`, `drop-table`,
  `rename-column`, `rename-table`; SQL-scan `truncate-in-migration`.
- Postgres statement layer via `libpg-query` (the only runtime dependency,
  lazy-loaded): `create-index-non-concurrently`,
  `add-column-not-null-no-default`, `set-not-null`, `alter-column-type` (with
  a safe-widening whitelist), `add-fk-without-not-valid`,
  `add-check-without-not-valid`, `add-primary-key-on-existing-table`,
  `volatile-default-on-add-column`. Falls back to a regex-degraded mode if the
  parser can't load.
- Suppression comments (`disable-next-statement` / `disable-file`).
- Scoping: `--since <git-ref>`, `--all`, and a config `baseline` (+ `baseline`
  command). Squashed/rewritten history fails safe.
- Config file `.drizzle-migration-lint.json` with per-rule severity overrides.
- Reporters: `pretty`, `json`, and `github` (annotations + job summary;
  default under `$GITHUB_ACTIONS`).
