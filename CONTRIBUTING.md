# Contributing

Thanks for your interest!

## Setup

```sh
npm ci
npm run build && npm run typecheck
npm test
```

## Quality gates (all enforced in CI except mutation)

```sh
npm run test:cov          # 100% statements/branches/functions/lines — no exceptions
npm run lint
npm run lint:complexity   # sonarjs cognitive-complexity ≤ 15 per function
npm run fixtures:regen    # then: git diff --exit-code test/fixtures  (determinism)
npm run test:mutation     # local-only, run before opening a PR
```

## Fixtures

Every rule is exercised through committed fixtures under `test/fixtures/`,
generated deterministically by `scripts/fixtures-regen.mjs` with pinned
drizzle-kit versions (legacy 0.31.x layout and v1 folder layout). Never edit
generated fixture files by hand — change the fixture's schema pair and re-run
the regen script. Handmade fixtures (edited SQL) are marked
`"mode": "handmade"` in their `fixture.json` and are exempt from regen.

## Pre-release smoke

Before tagging a release, run the real-project smoke described in
`docs/release-smoke.md` (packed tarball against freshly generated drizzle-kit
projects in both artifact formats).
