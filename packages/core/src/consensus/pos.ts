import { type BlockHeader, headerPrefixBytes } from '../block'
import { Reader, Writer, bytesToBigInt, equalBytes } from '../bytes'
import { sha256 } from '../hash'
import { type Address, addressFromPublicKey, sign, verify } from '../keys'
import { ConsensusMode, PARAMS } from '../params'
import type { ChainState } from '../state'
import { type Consensus, ValidationError } from './types'

/**
 * Proof of Stake. Each height has rounds of SLOT_MS; round r opens at
 * parent time + (r + 1) × SLOT_MS. The round's proposer is drawn with
 * probability proportional to stake, seeded by the parent hash, so anyone can
 * recompute it. If the proposer doesn't show up, the next round's proposer can.
 * Other stakers attest (sign the parent hash); the proposer bundles attestations.
 *
 * proof = pubkey[32] | sig[64] | u32 n | n × (pubkey[32] | sig[64])
 */
export const SLOT_MS = PARAMS.TARGET_BLOCK_MS

export interface Staker {
  address: Address
  stake: bigint
}

export interface Attestation {
  publicKey: Uint8Array
  signature: Uint8Array
}

export function stakers(s: ChainState): Staker[] {
  return [...s.accounts.entries()]
    .filter(([, a]) => a.stake > 0n)
    .map(([address, a]) => ({ address, stake: a.stake }))
    .sort((a, b) => (a.address < b.address ? -1 : 1))
}

export function totalStake(s: ChainState): bigint {
  return stakers(s).reduce((t, x) => t + x.stake, 0n)
}

/** Round for a block at `timestamp` on top of a parent at `parentTs`; -1 means too early. */
export function posRound(parentTs: number, timestamp: number): number {
  const since = timestamp - parentTs
  return since < SLOT_MS ? -1 : Math.floor(since / SLOT_MS) - 1
}

export function roundOpensAt(parentTs: number, round: number): number {
  return parentTs + (round + 1) * SLOT_MS
}

/** Stake-weighted pick for (parent, round). Null when nobody has stake. */
export function posLeader(parent: ChainState, round: number): Address | null {
  const list = stakers(parent)
  const total = list.reduce((t, x) => t + x.stake, 0n)
  if (total === 0n) return null
  const seed = sha256(new Writer().str('ISFCR-LEADER').fixed(parent.tipHash, 32).u64(parent.height + 1).u32(round).bytes())
  let r = bytesToBigInt(seed) % total
  for (const x of list) {
    if (r < x.stake) return x.address
    r -= x.stake
  }
  return list[list.length - 1].address
}

/** What the proposer signs: the header without its proof (so attestations can be added) and nonce. */
export function posSigningBytes(h: BlockHeader): Uint8Array {
  return new Writer().str('ISFCR-POS').raw(headerPrefixBytes({ ...h, proof: new Uint8Array(0) })).bytes()
}

export function attestationBytes(chainId: string, blockHash: Uint8Array): Uint8Array {
  return new Writer().str('ISFCR-ATTEST').str(chainId).fixed(blockHash, 32).bytes()
}

export function signAttestation(chainId: string, blockHash: Uint8Array, priv: Uint8Array, pub: Uint8Array): Attestation {
  return { publicKey: pub, signature: sign(attestationBytes(chainId, blockHash), priv) }
}

export function encodePosProof(pub: Uint8Array, sig: Uint8Array, atts: Attestation[]): Uint8Array {
  const w = new Writer().fixed(pub, 32).fixed(sig, 64).u32(atts.length)
  for (const a of atts) w.fixed(a.publicKey, 32).fixed(a.signature, 64)
  return w.bytes()
}

export function decodePosProof(proof: Uint8Array): { publicKey: Uint8Array; signature: Uint8Array; attestations: Attestation[] } {
  const r = new Reader(proof)
  const publicKey = r.fixed(32)
  const signature = r.fixed(64)
  const n = r.u32()
  if (n > 1000) throw new Error('too many attestations')
  const attestations: Attestation[] = []
  for (let i = 0; i < n; i++) attestations.push({ publicKey: r.fixed(32), signature: r.fixed(64) })
  if (!r.done) throw new Error('trailing bytes in PoS proof')
  return { publicKey, signature, attestations }
}

/** Signs a PoS template, keeping any attestations the node already bundled into its proof. */
export function sealPosHeader(h: BlockHeader, priv: Uint8Array, pub: Uint8Array): BlockHeader {
  let atts: Attestation[] = []
  try {
    if (h.proof.length >= 100) atts = decodePosProof(h.proof).attestations
  } catch {
    atts = []
  }
  const sig = sign(posSigningBytes(h), priv)
  return { ...h, proof: encodePosProof(pub, sig, atts) }
}

/** True if the header carries a valid proposer signature (used for slashing evidence too). */
export function posSignatureValid(h: BlockHeader): boolean {
  try {
    const p = decodePosProof(h.proof)
    return addressFromPublicKey(p.publicKey) === h.proposer && verify(p.signature, posSigningBytes(h), p.publicKey)
  } catch {
    return false
  }
}

export const proofOfStake: Consensus = {
  mode: ConsensusMode.PoS,
  name: 'Proof of Stake',
  slotting: 'slotted',
  validateProof(header, parent) {
    if (header.nonce !== 0n) throw new ValidationError('PoS blocks have no nonce')
    const parentTs = parent.recentTimestamps[parent.recentTimestamps.length - 1]
    const round = posRound(parentTs, header.timestamp)
    if (round < 0) throw new ValidationError('too early: the next PoS slot has not opened')
    const leader = posLeader(parent, round)
    if (!leader) throw new ValidationError('nobody has stake, so no one can propose')
    if (header.proposer !== leader) throw new ValidationError(`not the proposer for round ${round}`)
    let p
    try {
      p = decodePosProof(header.proof)
    } catch (e) {
      throw new ValidationError(`bad PoS proof: ${(e as Error).message}`)
    }
    if (addressFromPublicKey(p.publicKey) !== header.proposer || !verify(p.signature, posSigningBytes(header), p.publicKey)) {
      throw new ValidationError('bad proposer signature')
    }
    const seen = new Set<string>()
    const msg = attestationBytes(parent.genesis.chainId, header.prevHash)
    for (const a of p.attestations) {
      const who = addressFromPublicKey(a.publicKey)
      if (seen.has(who)) throw new ValidationError('duplicate attestation')
      seen.add(who)
      if ((parent.accounts.get(who)?.stake ?? 0n) === 0n) throw new ValidationError('attestation from a non-staker')
      if (!verify(a.signature, msg, a.publicKey)) throw new ValidationError('bad attestation signature')
    }
  },
}

/** Stake (in the parent state) that attested to the parent, as a fraction 0–1. */
export function attestedShare(header: BlockHeader, parent: ChainState): number {
  const total = totalStake(parent)
  if (total === 0n) return 0
  let sum = 0n
  for (const a of decodePosProof(header.proof).attestations) sum += parent.accounts.get(addressFromPublicKey(a.publicKey))?.stake ?? 0n
  return Number((sum * 10_000n) / total) / 10_000
}

export function sameProposerConflict(a: BlockHeader, b: BlockHeader): boolean {
  return a.height === b.height && a.proposer === b.proposer && !equalBytes(posSigningBytes(a), posSigningBytes(b))
}

