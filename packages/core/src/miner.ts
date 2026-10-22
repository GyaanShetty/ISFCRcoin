import { Writer } from './bytes'
import { type BlockHeader, headerPrefixBytes, hashMeetsTarget } from './block'
import { sha256 } from './hash'

export interface MineResult {
  nonce: bigint
  hash: Uint8Array
  tries: number
}

/**
 * Grinds nonces from `start` for up to `maxTries` attempts. Serialises the header
 * prefix once and only rewrites the 8 nonce bytes, which keeps phones usable.
 */
export function mineRange(header: BlockHeader, start: bigint, maxTries: number, target = header.target): MineResult | null {
  const prefix = headerPrefixBytes(header)
  const buf = new Writer().raw(prefix).u64(0).bytes()
  const view = new DataView(buf.buffer, buf.byteOffset + prefix.length, 8)
  let nonce = start
  for (let i = 0; i < maxTries; i++, nonce++) {
    view.setBigUint64(0, nonce, false)
    const hash = sha256(buf)
    if (hashMeetsTarget(hash, target)) return { nonce, hash, tries: i + 1 }
  }
  return null
}

export interface ShareResult {
  found: MineResult | null
  /** Nonces whose hash met the (easier) share target but not the block target. */
  shares: bigint[]
  tries: number
}

/** Like mineRange, but also collects shares (proof of hashrate for Dynamic PoW). */
export function mineWithShares(header: BlockHeader, start: bigint, maxTries: number, shareTarget: bigint): ShareResult {
  const prefix = headerPrefixBytes(header)
  const buf = new Writer().raw(prefix).u64(0).bytes()
  const view = new DataView(buf.buffer, buf.byteOffset + prefix.length, 8)
  const shares: bigint[] = []
  let nonce = start
  for (let i = 0; i < maxTries; i++, nonce++) {
    view.setBigUint64(0, nonce, false)
    const hash = sha256(buf)
    if (hashMeetsTarget(hash, header.target)) return { found: { nonce, hash, tries: i + 1 }, shares, tries: i + 1 }
    if (hashMeetsTarget(hash, shareTarget)) shares.push(nonce)
  }
  return { found: null, shares, tries: maxTries }
}
