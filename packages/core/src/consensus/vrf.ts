import { type BlockHeader, headerPrefixBytes } from '../block'
import { Writer, bytesToBigInt, concatBytes } from '../bytes'
import { sha256 } from '../hash'
import { addressFromPublicKey, sign, verify } from '../keys'
import { ConsensusMode } from '../params'
import type { ChainState } from '../state'
import { MAX_TARGET } from './pow'
import { posRound } from './pos'
import { type Consensus, ValidationError } from './types'

/**
 * VRF Lottery: one address, one ticket. Each registered address signs
 * (chain, parent hash, height); Ed25519 is deterministic, so that signature is
 * a verifiable random draw no one can re-roll. The lowest SHA-256(ticket) wins.
 * Blocks still wait for the slot to open (parent time + 15 s), and fork choice
 * prefers the lower ticket at the same height.
 *
 * proof = pubkey[32] | ticket[64] | block signature[64]
 */
export function vrfMessage(chainId: string, prevHash: Uint8Array, height: number): Uint8Array {
  return new Writer().str('ISFCR-VRF').str(chainId).fixed(prevHash, 32).u64(height).bytes()
}

export function drawTicket(chainId: string, prevHash: Uint8Array, height: number, priv: Uint8Array): Uint8Array {
  return sign(vrfMessage(chainId, prevHash, height), priv)
}

/** The lottery number: lower is better. */
export function ticketValue(ticket: Uint8Array): bigint {
  return bytesToBigInt(sha256(ticket))
}

export function vrfSigningBytes(h: BlockHeader): Uint8Array {
  return new Writer().str('ISFCR-VRFBLOCK').raw(headerPrefixBytes({ ...h, proof: new Uint8Array(0) })).bytes()
}

export function sealVrfHeader(h: BlockHeader, ticket: Uint8Array, priv: Uint8Array, pub: Uint8Array): BlockHeader {
  return { ...h, proof: concatBytes(pub, ticket, sign(vrfSigningBytes(h), priv)) }
}

/** An address may enter only if it holds coins (registered via the faucet or a transfer). */
export function isRegistered(s: ChainState, address: string): boolean {
  const a = s.accounts.get(address)
  return !!a && a.balance + a.stake > 0n && address !== s.genesis.faucetAddress
}

/**
 * Fork-choice bonus for a lower ticket: always below half a block's base weight,
 * so it only breaks ties between blocks at the same height.
 */
export function vrfTiebreak(header: BlockHeader, base: bigint): bigint {
  if (header.proof.length !== 160) return 0n
  const v = ticketValue(header.proof.slice(32, 96))
  return (base * (MAX_TARGET - v)) / (2n * (MAX_TARGET + 1n))
}

export const vrfLottery: Consensus = {
  mode: ConsensusMode.VRFLottery,
  name: 'VRF Lottery',
  slotting: 'slotted',
  validateProof(header, parent) {
    if (header.nonce !== 0n) throw new ValidationError('lottery blocks have no nonce')
    const parentTs = parent.recentTimestamps[parent.recentTimestamps.length - 1]
    if (posRound(parentTs, header.timestamp) < 0) throw new ValidationError('too early: the lottery slot has not opened')
    if (header.proof.length !== 160) throw new ValidationError('lottery proof must be 160 bytes')
    const pub = header.proof.slice(0, 32)
    const ticket = header.proof.slice(32, 96)
    const blockSig = header.proof.slice(96)
    if (addressFromPublicKey(pub) !== header.proposer) throw new ValidationError('ticket belongs to someone else')
    if (!isRegistered(parent, header.proposer)) throw new ValidationError('only registered addresses can enter the lottery')
    if (!verify(ticket, vrfMessage(parent.genesis.chainId, header.prevHash, header.height), pub)) throw new ValidationError('bad lottery ticket')
    if (!verify(blockSig, vrfSigningBytes(header), pub)) throw new ValidationError('bad block signature')
  },
}
