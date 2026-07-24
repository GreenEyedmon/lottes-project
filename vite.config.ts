import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The cloudflare plugin runs src/worker in workerd during `pnpm dev`, so the
// dev server and production behave the same way.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
})
