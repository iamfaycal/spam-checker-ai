import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  server: {
    // In dev the client runs on Vite, the API on Express (:3000). In production
    // Express serves both from one origin (D18), so the client always calls /api.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
