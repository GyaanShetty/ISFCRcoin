import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha512'
import { bytesToHex, hexToBytes } from './bytes'
import { sha256 } from './hash'

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))

export type Address = string // "isfcr1" + 40 hex chars
export const ADDRESS_PREFIX = 'isfcr1'

export interface KeyPair {
  privateKey: Uint8Array // 32-byte seed
  publicKey: Uint8Array // 32 bytes
  address: Address
}

export function generateKeyPair(): KeyPair {
  return keyPairFromPrivate(ed.utils.randomPrivateKey())
}

export function keyPairFromPrivate(privateKey: Uint8Array): KeyPair {
  const publicKey = ed.getPublicKey(privateKey)
  return { privateKey, publicKey, address: addressFromPublicKey(publicKey) }
}

export function addressFromPublicKey(pub: Uint8Array): Address {
  return ADDRESS_PREFIX + bytesToHex(sha256(pub).slice(0, 20))
}

export function addressToBytes(addr: Address): Uint8Array {
  if (!isValidAddress(addr)) throw new Error(`invalid address: ${addr}`)
  return hexToBytes(addr.slice(ADDRESS_PREFIX.length))
}

export function addressFromBytes(b: Uint8Array): Address {
  if (b.length !== 20) throw new Error('address must be 20 bytes')
  return ADDRESS_PREFIX + bytesToHex(b)
}

export function isValidAddress(addr: string): addr is Address {
  return /^isfcr1[0-9a-f]{40}$/.test(addr)
}

export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed.sign(message, privateKey)
}

export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed.verify(signature, message, publicKey)
  } catch {
    return false
  }
}
