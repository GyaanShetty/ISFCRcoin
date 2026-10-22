import { Reader, Writer, bytesToHex, hexToBytes, bigIntToBytes32, bytesToBigInt } from './bytes'
import { sha256, type Hash } from './hash'
import { type Address, addressFromBytes, addressToBytes } from './keys'
import { merkleRoot } from './merkle'
import { ConsensusMode } from './params'
import { type Tx, txHash, txToJSON, txFromJSON } from './tx'

export const BLOCK_VERSION = 1

export interface BlockHeader {
  version: number
  height: number
  prevHash: Hash
  merkleRoot: Hash
  timestamp: number // ms since epoch
  mode: ConsensusMode
  proposer: Address
  target: bigint // PoW target; 0 for non-PoW modes
  nonce: bigint // PoW nonce; 0 for non-PoW modes
  proof: Uint8Array // mode-specific extra data (signatures, VRF output, ...)
}

export interface Block {
  header: BlockHeader
  txs: Tx[] // txs[0] is the coinbase
}

/** Header bytes excluding the nonce, so miners can serialise once and append nonces. */
export function headerPrefixBytes(h: BlockHeader): Uint8Array {
  return new Writer()
    .u8(h.version)
    .u64(h.height)
    .fixed(h.prevHash, 32)
    .fixed(h.merkleRoot, 32)
    .u64(h.timestamp)
    .u8(h.mode)
    .fixed(addressToBytes(h.proposer), 20)
    .fixed(bigIntToBytes32(h.target), 32)
    .varBytes(h.proof)
    .bytes()
}

export function encodeHeader(h: BlockHeader): Uint8Array {
  return new Writer().raw(headerPrefixBytes(h)).u64(h.nonce).bytes()
}

export function decodeHeader(bytes: Uint8Array): BlockHeader {
  const r = new Reader(bytes)
  const h: BlockHeader = {
    version: r.u8(),
    height: Number(r.u64()),
    prevHash: r.fixed(32),
    merkleRoot: r.fixed(32),
    timestamp: Number(r.u64()),
    mode: r.u8(),
    proposer: addressFromBytes(r.fixed(20)),
    target: bytesToBigInt(r.fixed(32)),
    proof: r.varBytes(),
    nonce: r.u64(),
  }
  if (!r.done) throw new Error('trailing bytes after header')
  return h
}

export function headerHash(h: BlockHeader): Hash {
  return sha256(encodeHeader(h))
}

export function blockHash(b: Block): Hash {
  return headerHash(b.header)
}

export function computeMerkleRoot(txs: Tx[]): Hash {
  return merkleRoot(txs.map(txHash))
}

export function hashMeetsTarget(hash: Hash, target: bigint): boolean {
  return bytesToBigInt(hash) <= target
}

// ---- JSON wire format ----

export function blockToJSON(b: Block) {
  const h = b.header
  return {
    hash: bytesToHex(headerHash(h)),
    header: {
      version: h.version,
      height: h.height,
      prevHash: bytesToHex(h.prevHash),
      merkleRoot: bytesToHex(h.merkleRoot),
      timestamp: h.timestamp,
      mode: h.mode,
      proposer: h.proposer,
      target: h.target.toString(16),
      nonce: h.nonce.toString(),
      proof: bytesToHex(h.proof),
    },
    txs: b.txs.map(txToJSON),
  }
}

export type BlockJSON = ReturnType<typeof blockToJSON>

export function blockFromJSON(j: any): Block {
  const h = j.header
  return {
    header: {
      version: Number(h.version),
      height: Number(h.height),
      prevHash: hexToBytes(h.prevHash),
      merkleRoot: hexToBytes(h.merkleRoot),
      timestamp: Number(h.timestamp),
      mode: Number(h.mode),
      proposer: String(h.proposer),
      target: BigInt('0x' + (h.target || '0')),
      nonce: BigInt(h.nonce),
      proof: hexToBytes(h.proof ?? ''),
    },
    txs: (j.txs as any[]).map(txFromJSON),
  }
}
