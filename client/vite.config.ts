import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // Use the shared contract's source directly (like Jest's moduleNameMapper on the
    // server), so the client never needs `shared` to be built first.
    alias: {
      '@spam-checker/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // In dev the client runs on Vite, the API on Express (:3000). In production
    // Express serves both from one origin (D18), so the client always calls /api.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom', // components need a DOM; pure lib tests run fine in it too
  },
})
