import { defineConfig } from 'drizzle-kit'

// SQL is generated here and applied to D1 via `wrangler d1 migrations apply` (see the
// db:migrate scripts). We deliberately do not use drizzle-kit's own d1-http apply, so no
// driver/credentials are needed — migrations stay reviewable in-repo.
export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/worker/db/schema.ts', './src/worker/db/auth-schema.ts'],
  out: './migrations',
})
