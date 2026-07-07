# CLAUDE.md

@GUIDELINES_DRIZZLE_MIGRATION_LINT.md

The imported guidelines are the binding project constitution. Always-on rules:

- **Every commit must pass the full gate** — no exceptions:
  `npm run build && npm run typecheck && npm run lint && npm run complexity:check && npm run test:cov`
  (100% coverage on all four metrics; SonarJS cognitive complexity ≤ 15).
- **`libpg-query` is the ONLY runtime dependency**, lazy-loaded for Postgres.
  Do not add a second one. The CLI stays zero-dependency (`node:util`
  `parseArgs`).
- **The tool is READ-ONLY and offline by default.** Never run a user's
  migrations or import their `drizzle.config` (it is regex-scanned, never
  executed). The only database access is opt-in `--db-url` size introspection —
  a single read-only query the user explicitly enables; never connect otherwise.
- **Fixtures are deterministic.** After any change to parsing, the differ, or a
  rule, run `npm run fixtures:regen` and confirm `git diff --exit-code
  test/fixtures` is clean. Never hand-edit a generated fixture — change its
  schema pair and regenerate. Hand-authored fixtures are marked
  `"mode": "handmade"`.
- **Mutation testing (Stryker) is local-only** and must never be wired into CI.
