import { type Block, type BlockHeader, BLOCK_VERSION, computeMerkleRoot } from './block'
import type { Address } from './keys'
import { PARAMS } from './params'
import { type ChainState, type ApplyOptions, cappedReward, expectedMode } from './state'
import { type SignedTx, TxType } from './tx'
import { ConsensusMode } from './params'
import { SLOT_MS } from './consensus/pos'

/**
 * Assembles an unsealed block (nonce 0, empty proof) on top of `parent`.
 * Miners then fill in nonce/proof according to the active consensus mode.
 */
export function buildBlockTemplate(
  parent: ChainState,
  proposer: Address,
  txs: SignedTx[],
  timestamp: number,
  opts: ApplyOptions = {},
): Block {
  const chosen = txs.slice(0, PARAMS.MAX_TXS_PER_BLOCK)
  const height = parent.height + 1
  const fees = chosen.reduce((sum, t) => sum + t.fee, 0n)
  const allTxs = [{ type: TxType.Coinbase as const, height, to: proposer, amount: cappedReward(parent, height) + fees }, ...chosen]
  const parentTs = parent.recentTimestamps[parent.recentTimestamps.length - 1]
  const mode = expectedMode(parent, height, opts)
  // Slotted modes can't stamp a block before its slot opens.
  if (mode !== ConsensusMode.GlobalPoW && mode !== ConsensusMode.DynamicPoW) timestamp = Math.max(timestamp, parentTs + SLOT_MS)
  const header: BlockHeader = {
    version: BLOCK_VERSION,
    height,
    prevHash: parent.tipHash,
    merkleRoot: computeMerkleRoot(allTxs),
    timestamp: Math.max(timestamp, parentTs),
    mode,
    proposer,
    target: parent.target,
    nonce: 0n,
    proof: new Uint8Array(0),
  }
  return { header, txs: allTxs }
}
