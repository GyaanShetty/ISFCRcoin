import { defineConfig } from 'vitest/config'

// Forked workers hang in some sandboxed environments; threads work everywhere.
export default defineConfig({ test: { pool: 'threads' } })
