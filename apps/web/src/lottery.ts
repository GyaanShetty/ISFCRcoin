import { useSyncExternalStore } from 'react'
import { ConsensusMode, blockFromJSON, blockToJSON, bytesToHex, drawTicket, hexToBytes, sealVrfHeader, ticketValue } from '@isfcr/core'
import { api, type LotteryStatus } from './api'
import { getLive, subscribeLive } from './live'
import { getWallet } from './wallet'

/**
 * VRF Lottery from the student's side: on every new tip, draw our ticket (a
 * signature only our key can make, so it can't be re-rolled) and enter it.
 * When the slot opens and ours is the lowest, sign and submit the block.
 */
interface LotteryState {
  status: LotteryStatus | null
  myTicket: { height: number; value: string; ticket: Uint8Array } | null
  rank: number
  won: { height: number; status: string }[]
  error: string
}

let state: LotteryState = { status: null, myTicket: null, rank: 0, won: [], error: '' }
const listeners = new Set<() => void>()
const set = (p: Partial<LotteryState>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

const lotteryNow = () => {
  const info = getLive().info
  return info?.mode === ConsensusMode.VRFLottery || info?.scheduledSwitch?.mode === ConsensusMode.VRFLottery
}

let enteredFor = ''
const proposedFor = new Set<string>()

async function enter() {
  const key = getWallet().key
  const info = getLive().info
  if (!key || !info || !lotteryNow() || enteredFor === info.tip) return
  enteredFor = info.tip
  const height = info.height + 1
  const ticket = drawTicket(info.chainId, hexToBytes(info.tip), height, key.privateKey)
  set({ myTicket: { height, value: ticketValue(ticket).toString(16).padStart(64, '0'), ticket } })
  try {
    const r = await api.enterLottery(bytesToHex(key.publicKey), bytesToHex(ticket))
    set({ rank: r.rank, error: '' })
  } catch (e) {
    set({ rank: 0, error: (e as Error).message })
  }
}

async function poll() {
  const key = getWallet().key
  if (!key || !lotteryNow()) return
  try {
    const s = await api.lottery()
    const mine = state.myTicket
    set({ status: s, rank: s.ranking.findIndex((r) => r.address === key.address) + 1 })
    const tip = getLive().info?.tip ?? ''
    if (s.active && s.best?.address === key.address && Date.now() >= s.opensAt && mine?.height === s.height && !proposedFor.has(tip)) {
      proposedFor.add(tip)
      const block = blockFromJSON((await api.template(key.address)).block)
      block.header = sealVrfHeader(block.header, mine.ticket, key.privateKey, key.publicKey)
      const res = await api.submitBlock(blockToJSON(block))
      set({ won: [{ height: s.height, status: res.status }, ...state.won].slice(0, 10) })
    }
  } catch (e) {
    set({ error: (e as Error).message })
  }
}

subscribeLive(() => {
  enter()
})
setInterval(poll, 1500)

export function useLottery(): LotteryState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
}
