import { useSyncExternalStore } from 'react'
import {
  ConsensusMode, HOST_ATTESTED_MODES, Writer, actionBytes, blockFromJSON, blockToJSON, bytesToHex, hexToBytes, sealHostBlock, sha256, sign,
} from '@isfcr/core'
import { api, type RoundStatus } from './api'
import { getLive, subscribeLive } from './live'
import { getWallet } from './wallet'

/**
 * Host-run games from the student's side. Polls the round, signs actions, and does
 * the automatic parts: joins the PoET timer, reveals a locked-in PoK answer once
 * answers close, and proposes the block when the host certifies us as the winner.
 */
interface RoundState {
  status: RoundStatus | null
  won: { height: number; status: string }[]
  msg: string
}

let state: RoundState = { status: null, won: [], msg: '' }
const listeners = new Set<() => void>()
const set = (p: Partial<RoundState>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

const isGame = (m?: number) => m !== undefined && (HOST_ATTESTED_MODES as readonly number[]).includes(m)
const gameNow = () => isGame(getLive().info?.nextMode)

// Locked-in PoK answers, kept until the reveal: height → { choice, salt }
const pending = new Map<number, { choice: number; salt: string }>()
const joined = new Set<number>()
const revealed = new Set<number>()
const proposed = new Set<number>()

export async function act(action: string, body: Record<string, unknown> = {}): Promise<any> {
  const key = getWallet().key
  const info = getLive().info
  const s = state.status
  if (!key || !info || !s?.height) throw new Error('not ready')
  const sig = sign(actionBytes(info.chainId, s.height, action, body), key.privateKey)
  const r = await api.act(action, body, bytesToHex(key.publicKey), bytesToHex(sig))
  poll()
  return r
}

/** PoK: lock in a choice without revealing it (hash of choice, your address and a random salt). */
export async function lockAnswer(choice: number): Promise<void> {
  const key = getWallet().key!
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
  const commit = bytesToHex(sha256(new Writer().str('pok').str(String(choice)).str(key.address).str(salt).bytes()))
  await act('commit', { commit })
  pending.set(state.status!.height!, { choice, salt })
}

async function poll() {
  const key = getWallet().key
  if (!key || !gameNow()) return
  try {
    const s = await api.round(key.address)
    set({ status: s, msg: '' })
    if (!s.active || !s.height) return
    const h = s.height
    if (s.mode === ConsensusMode.PoET && s.myWaitMs == null && !joined.has(h)) {
      joined.add(h)
      await act('join').catch(() => {})
    }
    const mine = pending.get(h)
    if (s.mode === ConsensusMode.PoK && mine && Date.now() >= (s.opensAt ?? 0) && !revealed.has(h)) {
      revealed.add(h)
      await act('reveal', { choice: mine.choice, salt: mine.salt }).catch(() => {})
    }
    if (s.cert && !proposed.has(h)) {
      proposed.add(h)
      const block = blockFromJSON((await api.template(key.address)).block)
      block.header = sealHostBlock(block.header, hexToBytes(s.cert), key.privateKey, key.publicKey)
      const res = await api.submitBlock(blockToJSON(block))
      set({ won: [{ height: h, status: res.status }, ...state.won].slice(0, 10) })
    }
  } catch (e) {
    set({ msg: (e as Error).message })
  }
}

setInterval(poll, 1500)
subscribeLive(() => { if (gameNow()) poll() })

export function useRound(): RoundState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
}
