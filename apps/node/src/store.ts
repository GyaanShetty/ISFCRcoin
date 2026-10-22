import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

// Loaded via require: vite (vitest) strips the `node:` prefix and fails to resolve `sqlite`.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
import type { GenesisConfig } from '@isfcr/core'

export interface StoredBlock {
  hash: string
  height: number
  json: string
}

/** SQLite persistence: the current session's blocks, join codes, faucet claims, archived sessions. */
export class Store {
  private db: DatabaseSyncType

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS blocks (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT UNIQUE NOT NULL, height INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS join_codes (
        code TEXT PRIMARY KEY, token TEXT UNIQUE, created_at INTEGER NOT NULL, joined_at INTEGER);
      CREATE TABLE IF NOT EXISTS faucet_claims (
        token TEXT PRIMARY KEY, address TEXT NOT NULL, txid TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS mempool (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id TEXT NOT NULL, ended_at INTEGER NOT NULL,
        height INTEGER NOT NULL, leaderboard TEXT NOT NULL);
    `)
    try {
      this.db.exec('ALTER TABLE join_codes ADD COLUMN name TEXT')
    } catch {
      // column already exists
    }
  }

  setJoinName(code: string, name: string): void {
    this.db.prepare('UPDATE join_codes SET name = ? WHERE code = ?').run(name.slice(0, 40), code)
  }

  /** Display names for addresses that claimed the faucet this session (name, else the join code). */
  names(): Record<string, string> {
    const rows = this.db.prepare(
      'SELECT f.address AS address, COALESCE(j.name, j.code) AS name FROM faucet_claims f JOIN join_codes j ON j.token = f.token',
    ).all() as { address: string; name: string }[]
    return Object.fromEntries(rows.map((r) => [r.address, r.name]))
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  getGenesis(): GenesisConfig | undefined {
    const raw = this.getMeta('genesis')
    return raw ? genesisFromJSON(JSON.parse(raw)) : undefined
  }

  setGenesis(g: GenesisConfig): void {
    this.setMeta('genesis', JSON.stringify(genesisToJSON(g)))
  }

  saveBlock(hash: string, height: number, json: string): void {
    this.db.prepare('INSERT OR IGNORE INTO blocks (hash, height, json) VALUES (?, ?, ?)').run(hash, height, json)
  }

  loadBlocks(): StoredBlock[] {
    return this.db.prepare('SELECT hash, height, json FROM blocks ORDER BY height, seq').all() as unknown as StoredBlock[]
  }

  /** Pending txs survive restarts: replaced wholesale whenever the pool changes shape. */
  replaceMempool(entries: { id: string; json: string }[]): void {
    this.db.exec('BEGIN')
    try {
      this.db.exec('DELETE FROM mempool')
      const stmt = this.db.prepare('INSERT OR IGNORE INTO mempool (id, json) VALUES (?, ?)')
      for (const e of entries) stmt.run(e.id, e.json)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  saveMempoolTx(id: string, json: string): void {
    this.db.prepare('INSERT OR IGNORE INTO mempool (id, json) VALUES (?, ?)').run(id, json)
  }

  loadMempool(): string[] {
    return (this.db.prepare('SELECT json FROM mempool').all() as { json: string }[]).map((r) => r.json)
  }

  updateFaucetClaim(token: string, txid: string): void {
    this.db.prepare('UPDATE faucet_claims SET txid = ?, at = ? WHERE token = ?').run(txid, Date.now(), token)
  }

  addJoinCodes(codes: string[]): void {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO join_codes (code, created_at) VALUES (?, ?)')
    for (const c of codes) stmt.run(c, Date.now())
  }

  getJoinCode(code: string): { code: string; token: string | null } | undefined {
    return this.db.prepare('SELECT code, token FROM join_codes WHERE code = ?').get(code) as any
  }

  setJoinToken(code: string, token: string): void {
    this.db.prepare('UPDATE join_codes SET token = ?, joined_at = ? WHERE code = ?').run(token, Date.now(), code)
  }

  tokenExists(token: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM join_codes WHERE token = ?').get(token)
  }

  listJoinCodes(): { code: string; joined: boolean }[] {
    return (this.db.prepare('SELECT code, token FROM join_codes ORDER BY created_at').all() as any[]).map((r) => ({
      code: r.code,
      joined: !!r.token,
    }))
  }

  getFaucetClaim(token: string): { address: string; txid: string } | undefined {
    return this.db.prepare('SELECT address, txid FROM faucet_claims WHERE token = ?').get(token) as any
  }

  addFaucetClaim(token: string, address: string, txid: string): void {
    this.db.prepare('INSERT INTO faucet_claims (token, address, txid, at) VALUES (?, ?, ?, ?)').run(token, address, txid, Date.now())
  }

  /** Archives the leaderboard and wipes per-session data. Join codes survive. */
  endSession(chainId: string, height: number, leaderboard: unknown): void {
    this.db.prepare('INSERT INTO sessions (chain_id, ended_at, height, leaderboard) VALUES (?, ?, ?, ?)').run(
      chainId, Date.now(), height, JSON.stringify(leaderboard))
    this.db.exec('DELETE FROM blocks; DELETE FROM faucet_claims; DELETE FROM mempool;')
  }

  listSessions(): { id: number; chainId: string; endedAt: number; height: number; leaderboard: unknown }[] {
    return (this.db.prepare('SELECT * FROM sessions ORDER BY id DESC').all() as any[]).map((r) => ({
      id: r.id, chainId: r.chain_id, endedAt: r.ended_at, height: r.height, leaderboard: JSON.parse(r.leaderboard),
    }))
  }

  close(): void {
    this.db.close()
  }
}

export function genesisToJSON(g: GenesisConfig) {
  return {
    ...g,
    faucetAllocation: g.faucetAllocation.toString(),
    instructorAllocation: (g.instructorAllocation ?? 0n).toString(),
    initialTarget: g.initialTarget.toString(16),
  }
}

export function genesisFromJSON(j: any): GenesisConfig {
  return {
    chainId: String(j.chainId),
    timestamp: Number(j.timestamp),
    faucetAddress: String(j.faucetAddress),
    faucetAllocation: BigInt(j.faucetAllocation),
    instructorAddress: String(j.instructorAddress),
    instructorAllocation: BigInt(j.instructorAllocation ?? 0),
    initialMode: Number(j.initialMode),
    initialTarget: BigInt('0x' + j.initialTarget),
  }
}
