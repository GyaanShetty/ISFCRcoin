import { useSyncExternalStore } from 'react'
import { ConsensusMode } from '@isfcr/core'
import { api } from './api'
import { getLive, subscribeLive } from './live'
import type { MinerOut } from './miner.worker'
import { getWallet, subscribeWallet } from './wallet'
import './lottery' // follows the chain so lottery tickets are entered on any tab
import './validator'
import './round'

/**
 * Mining lives outside React so it keeps running while students switch tabs.
 * It follows the live feed: a new tip means a fresh template (and a restart
 * if mining); mempool changes refresh the template only while idle.
 */
export interface FoundBlock { height: number; status: string; at: number }
export type Picking = 'auto' | 'manual'

interface MinerState {
  mining: boolean
  rate: number
  tries: number
  nonce: string
  hash: string
  found: FoundBlock[]
  template: { block: any; reward: string; fees: string } | null
  picking: Picking
  picked: Set<string>
  hidden: boolean
  error: string
  /** Dynamic PoW: hashrate the host credits us with, from accepted shares. */
  creditedRate: number
}

let state: MinerState = {
  mining: false, rate: 0, tries: 0, nonce: '', hash: '', found: [], template: null,
  picking: 'auto', picked: new Set(), hidden: typeof document !== 'undefined' && document.hidden, error: '', creditedRate: 0,
}
const listeners = new Set<() => void>()
const set = (p: Partial<MinerState>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}

let worker: Worker | null = null
let wakeLock: any = null

// Shares are only valid for the header they were mined on, so they're buffered per header.
let shareBuf: { header: any; nonces: string[] } | null = null

async function flushShares() {
  const buf = shareBuf
  if (!buf || buf.nonces.length === 0) return
  shareBuf = { header: buf.header, nonces: [] }
  try {
    const r = await api.submitShares(buf.header, buf.nonces)
    set({ creditedRate: r.hashrate })
  } catch {
    // stale tip or mode changed; shares are simply dropped
  }
}
setInterval(flushShares, 3000)

// Dynamic PoW tickets are sized from our hashrate at the time they were issued; refresh
// them while mining so a phone that slows down (or a laptop that wakes up) gets a fair target.
setInterval(() => {
  if (state.mining && state.template?.block.header.mode === ConsensusMode.DynamicPoW) refreshTemplate()
}, 20_000)

function post(block: any) {
  if (!worker) {
    worker = new Worker(new URL('./miner.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<MinerOut>) => onWorker(e.data)
  }
  flushShares()
  const dynamic = block.header.mode === ConsensusMode.DynamicPoW
  shareBuf = dynamic ? { header: block.header, nonces: [] } : null
  set({ tries: 0, hash: '', nonce: '' })
  worker.postMessage({
    type: 'start', block, startNonce: BigInt(Math.floor(Math.random() * 2 ** 48)).toString(),
    shareTarget: dynamic ? getLive().info?.params.shareTarget : undefined,
  })
}

async function onWorker(m: MinerOut) {
  if (shareBuf && m.shares.length) shareBuf.nonces.push(...m.shares)
  if (m.type === 'progress') return set({ rate: m.rate, tries: m.tries, nonce: m.nonce, hash: m.hash })
  const t = state.template
  if (!t) return
  const block = { ...t.block, header: { ...t.block.header, nonce: m.nonce } }
  let status: string
  try {
    status = (await api.submitBlock(block)).status
  } catch (e) {
    status = (e as Error).message
  }
  set({ found: [{ height: block.header.height, status, at: Date.now() }, ...state.found].slice(0, 20) })
  // If the tip didn't move (our block lost a race), keep grinding the same template.
  const current = state.template
  if (state.mining && current && current.block.header.prevHash === block.header.prevHash) post(current.block)
}

async function refreshTemplate() {
  const key = getWallet().key
  if (!key) return
  try {
    const t = await api.template(key.address, state.picking === 'manual' ? [...state.picked] : undefined)
    set({ template: t, error: '' })
    const pow = t.block.header.mode === ConsensusMode.GlobalPoW || t.block.header.mode === ConsensusMode.DynamicPoW
    // The class switched to a mode without hashing: stop instead of grinding a useless nonce.
    if (state.mining && !pow) miner.stop()
    else if (state.mining) post(t.block)
  } catch (e) {
    set({ error: (e as Error).message })
  }
}

async function requestWakeLock() {
  try {
    wakeLock = await (navigator as any).wakeLock?.request('screen')
  } catch {
    // unsupported or not a secure context; the hidden-tab warning still helps
  }
}

let lastTip = ''
let lastMempool = -1
subscribeLive(() => {
  const live = getLive()
  const tip = live.info?.tip ?? ''
  if (tip !== lastTip) {
    lastTip = tip
    lastMempool = live.mempoolVersion
    refreshTemplate()
  } else if (live.mempoolVersion !== lastMempool) {
    lastMempool = live.mempoolVersion
    if (!state.mining) refreshTemplate()
  }
})
let lastAddr = ''
subscribeWallet(() => {
  const addr = getWallet().key?.address ?? ''
  if (addr !== lastAddr) {
    lastAddr = addr
    refreshTemplate()
  }
})

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    set({ hidden: document.hidden })
    if (!document.hidden && state.mining) requestWakeLock()
  })
}

export const miner = {
  start() {
    if (state.mining || !state.template) return
    set({ mining: true })
    requestWakeLock()
    post(state.template.block)
  },
  stop() {
    worker?.postMessage({ type: 'stop' })
    wakeLock?.release?.()
    set({ mining: false, rate: 0, tries: 0 })
  },
  toggle() {
    state.mining ? miner.stop() : miner.start()
  },
  setPicking(picking: Picking) {
    set({ picking })
    refreshTemplate()
  },
  togglePick(id: string) {
    const picked = new Set(state.picked)
    picked.has(id) ? picked.delete(id) : picked.add(id)
    set({ picked })
    refreshTemplate()
  },
  refresh: refreshTemplate,
}

export function useMiner(): MinerState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
}
