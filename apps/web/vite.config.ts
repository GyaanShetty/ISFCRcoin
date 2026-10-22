import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const node = process.env.NODE_URL ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: {
    proxy: {
      '/api': node,
      '/ws': { target: node.replace(/^http/, 'ws'), ws: true },
    },
  },
})
