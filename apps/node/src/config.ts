import { fileURLToPath } from 'node:url'
import { type KeyPair, MAX_TARGET, hexToBytes, keyPairFromPrivate, sha256, utf8ToBytes } from '@isfcr/core'

export interface NodeConfig {
  port: number
  host: string
  dbPath: string
  chainName: string
  faucet: KeyPair
  instructor: KeyPair
  adminToken: string
  /** Skip join codes: any name gets a session (dev / trusted rooms). */
  openJoin: boolean
  /** Initial global PoW target; retargeting takes over from here. */
  initialTarget: bigint
  /** Base URLs of peer seed nodes, e.g. http://10.0.0.2:8080 */
  peers: string[]
  /** Follow a peer's genesis (secondary seed node). */
  followPeer: boolean
  /** Fork demo: ignore governance-scheduled consensus switches. */
  oldRules: boolean
  txgen: { enabled: boolean; bots: number; intervalMs: number }
  webDist?: string
}

function seedKey(envName: string, devLabel: string, warnings: string[]): KeyPair {
  const hex = process.env[envName]
  if (hex) return keyPairFromPrivate(hexToBytes(hex))
  warnings.push(`${envName} not set; using an insecure dev key`)
  return keyPairFromPrivate(sha256(utf8ToBytes(devLabel)))
}

export function loadConfig(env = process.env): { config: NodeConfig; warnings: string[] } {
  const warnings: string[] = []
  const initialWork = BigInt(env.INITIAL_WORK ?? 1 << 18)
  const adminToken = env.ADMIN_TOKEN ?? 'dev-admin'
  if (!env.ADMIN_TOKEN) warnings.push('ADMIN_TOKEN not set; using "dev-admin"')
  return {
    warnings,
    config: {
      port: Number(env.PORT ?? 8080),
      host: env.HOST ?? '0.0.0.0',
      dbPath: env.DB_PATH ?? './data/isfcr.sqlite',
      chainName: env.CHAIN_NAME ?? 'isfcr',
      faucet: seedKey('FAUCET_SEED', 'isfcr-dev-faucet', warnings),
      instructor: seedKey('INSTRUCTOR_SEED', 'isfcr-dev-instructor', warnings),
      adminToken,
      openJoin: (env.OPEN_JOIN ?? '1') === '1',
      initialTarget: MAX_TARGET / initialWork,
      peers: (env.PEERS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
      followPeer: env.FOLLOW_PEER === '1',
      oldRules: env.OLD_RULES === '1',
      txgen: {
        enabled: (env.TXGEN ?? '1') === '1',
        bots: Number(env.TXGEN_BOTS ?? 8),
        intervalMs: Number(env.TXGEN_INTERVAL_MS ?? 600),
      },
      // Defaults to the built web app in this repo, independent of the working directory.
      webDist: env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
    },
  }
}
