import { sha256, ZERO_HASH, type Hash } from './hash'
import { equalBytes } from './bytes'

/**
 * Bitcoin-style Merkle tree: pair up hashes level by level, duplicating the
 * last one when a level has an odd count. Returns every level (leaves first)
 * so clients can draw the tree.
 */
export function merkleLevels(leaves: Hash[]): Hash[][] {
  if (leaves.length === 0) return [[ZERO_HASH]]
  const levels: Hash[][] = [leaves]
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1]
    const next: Hash[] = []
    for (let i = 0; i < prev.length; i += 2) {
      next.push(sha256(prev[i], prev[i + 1] ?? prev[i]))
    }
    levels.push(next)
  }
  return levels
}

export function merkleRoot(leaves: Hash[]): Hash {
  const levels = merkleLevels(leaves)
  return levels[levels.length - 1][0]
}

export interface MerkleProofStep {
  sibling: Hash
  siblingOnLeft: boolean
}

export function merkleProof(leaves: Hash[], index: number): MerkleProofStep[] {
  const levels = merkleLevels(leaves)
  const proof: MerkleProofStep[] = []
  for (let l = 0; l < levels.length - 1; l++) {
    const level = levels[l]
    const isRight = index % 2 === 1
    const siblingIdx = isRight ? index - 1 : index + 1
    proof.push({ sibling: level[siblingIdx] ?? level[index], siblingOnLeft: isRight })
    index = Math.floor(index / 2)
  }
  return proof
}

export function verifyMerkleProof(leaf: Hash, proof: MerkleProofStep[], root: Hash): boolean {
  let h = leaf
  for (const step of proof) h = step.siblingOnLeft ? sha256(step.sibling, h) : sha256(h, step.sibling)
  return equalBytes(h, root)
}
