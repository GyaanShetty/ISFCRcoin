import { useSyncExternalStore } from 'react'
import { ConsensusMode, blockFromJSON, blockToJSON, bytesToHex, hexToBytes, sealPosHeader, signAttestation } from '@isfcr/core'
import { api, type PosStatus } from './api'
import { getLive, subscribeLive } from './live'
import { getWallet } from './wallet'

/**
 * Proof of Stake from the student's side. While the class is in PoS mode this
 * polls the slot schedule; when we lead the current round it signs and submits
 * our block. It also attests (signs) every new tip while we have stake.
 */
interface ValidatorState {
  status: PosStatus | null
  proposed: { height: number; status: string }[]
  error: string
  /** Cheat on our next turn: sign two different blocks for the slot. */
  armed: boolean
  cheatResult: string
}

let state: ValidatorState = { status: null, proposed: [], error: '', armed: false, cheatResult: '' }
const listeners = new Set<() => void>()
const set = (p: Partial<ValidatorState>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

const done = new Set<string>() // `${height}:${round}` we already proposed
const attested = new Set<string>()

const posNow = () => {
  const info = getLive().info
  return info?.mode === ConsensusMode.PoS || info?.scheduledSwitch?.mode === ConsensusMode.PoS
}

async function signedTemplate(address: string) {
  const key = getWallet().key!
  const block = blockFromJSON((await api.template(address)).block)
  block.header = sealPosHeader(block.header, key.privateKey, key.publicKey)
  return blockToJSON(block)
}

/** Two different signed blocks for the same slot, built from one template before either is sent. */
async function signedPair(address: string) {
  const key = getWallet().key!
  const tpl = blockFromJSON((await api.template(address)).block)
  const a = { ...tpl, header: sealPosHeader(tpl.header, key.privateKey, key.publicKey) }
  const b = { ...tpl, header: sealPosHeader({ ...tpl.header, timestamp: tpl.header.timestamp + 1 }, key.privateKey, key.publicKey) }
  return [blockToJSON(a), blockToJSON(b)]
}

async function poll() {
  const key = getWallet().key
  if (!key || !posNow()) return
  try {
    const s = await api.pos()
    set({ status: s, error: '' })
    const slot = `${s.height}:${s.round}`
    if (s.active && s.leader === key.address && Date.now() >= s.opensAt && !done.has(slot)) {
      done.add(slot)
      if (state.armed) {
        set({ armed: false })
        const [blockA, blockB] = await signedPair(key.address)
        const a = await api.submitBlock(blockA)
        const b = await api.submitBlock(blockB).catch((e) => ({ status: (e as Error).message }))
        set({ cheatResult: `You signed two blocks for #${s.height} (A: ${a.status}, B: ${b.status}). Watch what happens to your stake…` })
        return
      }
      const res = await api.submitBlock(await signedTemplate(key.address))
      set({ proposed: [{ height: s.height, status: res.status }, ...state.proposed].slice(0, 10) })
    }
  } catch (e) {
    set({ error: (e as Error).message })
  }
}
setInterval(poll, 1500)

// Attest to each new tip while we have stake.
subscribeLive(() => {
  const key = getWallet().key
  const info = getLive().info
  if (!key || !info || !posNow() || attested.has(info.tip)) return
  const mine = state.status?.stakers.find((x) => x.address === key.address)
  if (!mine) return
  attested.add(info.tip)
  const a = signAttestation(info.chainId, hexToBytes(info.tip), key.privateKey, key.publicKey)
  api.attest(info.tip, bytesToHex(a.publicKey), bytesToHex(a.signature)).catch(() => {})
})

export const validator = {
  refresh: poll,
  /** Cheat on purpose at our next turn: sign two different blocks for the same slot. */
  arm(on: boolean) {
    set({ armed: on, cheatResult: '' })
  },
}

export function useValidator(): ValidatorState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
}
