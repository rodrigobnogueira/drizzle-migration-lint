# Changelog

## 0.1.0 (unreleased)

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
