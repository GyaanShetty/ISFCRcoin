import { type BlockHeader, hashMeetsTarget } from '../block'
import { Writer, bigIntToBytes32, concatBytes } from '../bytes'
import { addressFromPublicKey, addressToBytes, sign, verify } from '../keys'
import { ConsensusMode } from '../params'
import { MAX_TARGET } from './pow'
import { type Consensus, ValidationError } from './types'

/**
 * Dynamic PoW: the host (instructor key) signs a per-miner target for one
 * height, sized from that miner's measured hashrate so everyone has roughly
 * equal odds. The ticket travels in header.proof as pubkey[32] | sig[64].
 * Trusting the host's hashrate estimate is the deliberate weak spot.
 */
export const SHARE_WORK = 1n << 16n // expected hashes per share
export const SHARE_TARGET = MAX_TARGET / SHARE_WORK

export function ticketBytes(chainId: string, height: number, proposer: string, target: bigint): Uint8Array {
  return new Writer()
    .str('ISFCR-DIFF')
    .str(chainId)
    .u64(height)
    .fixed(addressToBytes(proposer), 20)
    .fixed(bigIntToBytes32(target), 32)
    .bytes()
}

export function signTicket(chainId: string, height: number, proposer: string, target: bigint, hostPriv: Uint8Array, hostPub: Uint8Array): Uint8Array {
  return concatBytes(hostPub, sign(ticketBytes(chainId, height, proposer, target), hostPriv))
}

export function checkTicket(header: BlockHeader, chainId: string, hostAddress: string): void {
  const p = header.proof
  if (p.length !== 96) throw new ValidationError('dynamic PoW block needs a 96-byte difficulty ticket')
  const pub = p.slice(0, 32)
  if (addressFromPublicKey(pub) !== hostAddress) throw new ValidationError('difficulty ticket not signed by the host key')
  if (!verify(p.slice(32), ticketBytes(chainId, header.height, header.proposer, header.target), pub)) {
    throw new ValidationError('bad difficulty ticket signature')
  }
}

export const dynamicPoW: Consensus = {
  mode: ConsensusMode.DynamicPoW,
  name: 'Dynamic PoW',
  slotting: 'continuous',
  validateProof(header, parent, ctx) {
    if (header.target <= 0n || header.target > MAX_TARGET) throw new ValidationError('target out of range')
    checkTicket(header, parent.genesis.chainId, parent.genesis.instructorAddress)
    if (!hashMeetsTarget(ctx.hash, header.target)) throw new ValidationError('block hash does not meet target')
  },
}
