# Security Policy

## Supported versions

Only the latest published minor receives fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository
("Report a vulnerability" under the Security tab). You should receive a
response within a week.

Notes on the tool's security posture:

- The CLI only ever **reads** files (migration SQL, snapshots, its own JSON
  config). It never connects to a database and never executes user code —
  `drizzle.config.ts` is scanned with regexes, not imported.
- The only runtime dependency is the WebAssembly build of the Postgres
  parser, loaded lazily for the postgres dialect.
