import { sha256 as nobleSha256 } from '@noble/hashes/sha256'
import { bytesToHex, concatBytes } from './bytes'

export type Hash = Uint8Array // 32 bytes

export const ZERO_HASH: Hash = new Uint8Array(32)

export function sha256(...parts: Uint8Array[]): Hash {
  return nobleSha256(parts.length === 1 ? parts[0] : concatBytes(...parts))
}

export function hashHex(h: Hash): string {
  return bytesToHex(h)
}
