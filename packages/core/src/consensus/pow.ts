import { hashMeetsTarget } from '../block'
import { ConsensusMode } from '../params'
import { type Consensus, ValidationError } from './types'

export const MAX_TARGET = (1n << 256n) - 1n

/** Expected number of hashes to find a block at this target. */
export function workForTarget(target: bigint): bigint {
  return (1n << 256n) / (target + 1n)
}

export function difficulty(target: bigint): number {
  return Number(workForTarget(target))
}

export const globalPoW: Consensus = {
  mode: ConsensusMode.GlobalPoW,
  name: 'Global PoW',
  slotting: 'continuous',
  validateProof(header, parent, ctx) {
    if (header.target !== parent.target) {
      throw new ValidationError(`wrong target: expected ${parent.target.toString(16)}`)
    }
    if (!hashMeetsTarget(ctx.hash, header.target)) {
      throw new ValidationError('block hash does not meet target')
    }
  },
}
