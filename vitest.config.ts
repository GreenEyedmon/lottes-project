import { defineConfig } from 'vitest/config'

// Deliberately does NOT load vite.config.ts: these are fast, pure unit tests that
// should not boot workerd. Worker-integration tests can be added later with
// @cloudflare/vitest-pool-workers.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
