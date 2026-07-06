# Pre-release smoke test

Run this against a **packed tarball** before tagging a release, to confirm the
published artifact works end-to-end on a real drizzle-kit project (both
artifact formats). It exercises the paths unit tests can't: the real bin, the
lazy `libpg-query` load, and dir/dialect resolution from a real config.

```sh
# 1. Pack the tarball exactly as it will publish
npm run build
TARBALL="$(npm pack | tail -1)"

# 2. A throwaway pg project (v1 artifacts)
tmp="$(mktemp -d)"; cd "$tmp"
npm init -y >/dev/null
npm i drizzle-orm@rc pg >/dev/null
npm i -D drizzle-kit@rc typescript >/dev/null
cat > drizzle.config.ts <<'EOF'
import { defineConfig } from 'drizzle-kit';
export default defineConfig({ schema: './schema.ts', out: './drizzle', dialect: 'postgresql' });
EOF

# init: a bootstrap migration (must lint clean)
cat > schema.ts <<'EOF'
import { pgTable, serial, text } from 'drizzle-orm/pg-core';
export const users = pgTable('users', { id: serial('id').primaryKey(), email: text('email').notNull() });
EOF
npx drizzle-kit generate --name init

# evolve: three unsafe changes on the existing table
cat > schema.ts <<'EOF'
import { bigint, index, integer, pgTable, serial, text } from 'drizzle-orm/pg-core';
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),           // ADD COLUMN NOT NULL, no default
  n: bigint('n', { mode: 'number' }),
}, (t) => [index('users_email_idx').on(t.email)]);  // index on existing table
EOF
npx drizzle-kit generate --name evolve

# 3. Install the packed tool and lint
npm i -D "$TARBALL" >/dev/null
npx drizzle-migration-lint check --format json --fail-on error > out.json; echo "exit=$?"
# EXPECT: exit 1; errors on the evolve migration only (init lints clean);
#         add-column-not-null-no-default + create-index-non-concurrently.

# 4. Baseline + a third migration → only the new one is linted
npx drizzle-migration-lint baseline
# ... add another migration, then:
npx drizzle-migration-lint check --fail-on error   # only the post-baseline migration

# 5. --since in a scratch git repo
git init -q && git add -A && git commit -q -m snapshot
npx drizzle-migration-lint check --since HEAD --fail-on warn   # nothing new since HEAD → clean

cd - >/dev/null && rm -rf "$tmp" "$TARBALL"
```

Repeat step 2 with `drizzle-kit@0.31.10` + `drizzle-orm@0.45.2` to smoke the
**legacy** journal format.
