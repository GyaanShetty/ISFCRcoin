import { useSyncExternalStore } from 'react'
import type { Info } from './api'

/**
 * One WebSocket per tab, exposed as a tiny external store. Views re-fetch
 * what they need when `tipVersion` / `mempoolVersion` change.
 */
interface LiveState {
  connected: boolean
  info: Info | null
  tipVersion: number
  mempoolVersion: number
  lastBlock: { height: number; proposer: string; hash: string } | null
  reorgDepth: number
  lastSlash: { height: number; proposer: string; at: number } | null
  /** Most recent main-chain block (full JSON), for "what just happened" explanations. */
  lastBlockJson: any | null
  /** Class-wide events for the projector feed, newest first. */
  events: { at: number; kind: string; height: number; text: string; who?: string; mode?: number }[]
}

let state: LiveState = { connected: false, info: null, tipVersion: 0, mempoolVersion: 0, lastBlock: null, reorgDepth: 0, lastSlash: null, lastBlockJson: null, events: [] }
const listeners = new Set<() => void>()
const set = (patch: Partial<LiveState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

let mempoolTimer: ReturnType<typeof setTimeout> | null = null
const bumpMempool = () => {
  if (mempoolTimer) return
  mempoolTimer = setTimeout(() => {
    mempoolTimer = null
    set({ mempoolVersion: state.mempoolVersion + 1 })
  }, 1000)
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
  ws.onopen = () => set({ connected: true })
  ws.onclose = () => {
    set({ connected: false })
    setTimeout(connect, 2000)
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    switch (msg.type) {
      case 'hello':
        set({ info: msg.info, tipVersion: state.tipVersion + 1 })
        break
      case 'tip':
        set({ info: msg.info, tipVersion: state.tipVersion + 1, mempoolVersion: state.mempoolVersion + 1, reorgDepth: msg.reorgDepth })
        break
      case 'block':
        if (msg.main) set({ lastBlock: { height: msg.block.header.height, proposer: msg.block.header.proposer, hash: msg.block.hash }, lastBlockJson: msg.block })
        break
      case 'tx':
        bumpMempool()
        break
      case 'event':
        set({ events: [msg.event, ...state.events].slice(0, 40) })
        break
      case 'slash':
        set({ lastSlash: { height: msg.height, proposer: msg.proposer, at: Date.now() } })
        break
      case 'reset':
        set({ tipVersion: state.tipVersion + 1, mempoolVersion: state.mempoolVersion + 1 })
        break
    }
  }
}
connect()

export function subscribeLive(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const getLive = () => state

export function useLive(): LiveState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
}
