import type { BlockHeader } from '../block'
import type { ChainState } from '../state'
import type { ConsensusMode } from '../params'

export interface ValidateContext {
  /** Hash of the header being validated (precomputed). */
  hash: Uint8Array
}

/**
 * A consensus mode as seen by the shared validation code. Node-side engines
 * (slot clocks, collecting submissions, picking winners) live in apps/node and
 * build blocks that must pass validateProof here.
 */
export interface Consensus {
  mode: ConsensusMode
  name: string
  /** PoW races continuously; the other modes tick on a server slot clock. */
  slotting: 'continuous' | 'slotted'
  /** Throws ValidationError if the header's proof is not valid on top of parent. */
  validateProof(header: BlockHeader, parent: ChainState, ctx: ValidateContext): void
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
