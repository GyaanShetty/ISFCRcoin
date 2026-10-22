/// <reference lib="webworker" />
import { blockFromJSON, bytesToHex, headerHash, mineRange, mineWithShares } from '@isfcr/core'

// Grinds nonces in small chunks, yielding between them so a 'stop' (or a newer
// 'start' after the tip moves) takes effect immediately. In Dynamic PoW mode it
// also collects shares: easier hashes that prove this device's hashrate.
export type MinerIn = { type: 'start'; block: any; startNonce: string; shareTarget?: string } | { type: 'stop' }
export type MinerOut =
  | { type: 'progress'; tries: number; rate: number; nonce: string; hash: string; shares: string[] }
  | { type: 'found'; nonce: string; hash: string; tries: number; rate: number; shares: string[] }

const CHUNK = 4000
let job = 0

self.onmessage = async (e: MessageEvent<MinerIn>) => {
  const msg = e.data
  const my = ++job
  if (msg.type === 'stop') return
  const block = blockFromJSON(msg.block)
  const shareTarget = msg.shareTarget ? BigInt('0x' + msg.shareTarget) : null
  let nonce = BigInt(msg.startNonce)
  let tries = 0
  let shares: string[] = []
  const t0 = performance.now()
  let lastReport = t0
  const post = (m: MinerOut) => (self as unknown as Worker).postMessage(m)
  while (my === job) {
    let found: { nonce: bigint; hash: Uint8Array; tries: number } | null
    if (shareTarget !== null) {
      const r = mineWithShares(block.header, nonce, CHUNK, shareTarget)
      shares.push(...r.shares.map(String))
      found = r.found
    } else {
      found = mineRange(block.header, nonce, CHUNK)
    }
    const elapsed = (performance.now() - t0) / 1000
    if (found) {
      tries += found.tries
      post({ type: 'found', nonce: found.nonce.toString(), hash: bytesToHex(found.hash), tries, rate: Math.round(tries / Math.max(elapsed, 0.001)), shares })
      return
    }
    nonce += BigInt(CHUNK)
    tries += CHUNK
    const now = performance.now()
    if (now - lastReport > 400) {
      lastReport = now
      const hash = bytesToHex(headerHash({ ...block.header, nonce }))
      post({ type: 'progress', tries, rate: Math.round(tries / elapsed), nonce: nonce.toString(), hash, shares })
      shares = []
    }
    await new Promise((res) => setTimeout(res, 0))
  }
}
