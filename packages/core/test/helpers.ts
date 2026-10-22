import {
  type Block, type ChainState, type GenesisConfig, type KeyPair, type SignedTx, type TxBody,
  ConsensusMode, MAX_TARGET, UNIT, applyBlock, buildBlockTemplate, genesisState, keyPairFromPrivate,
  mineRange, signTx,
} from '../src'

export const seedKey = (n: number): KeyPair => keyPairFromPrivate(new Uint8Array(32).fill(n))

export const faucet = seedKey(1)
export const instructor = seedKey(2)
export const alice = seedKey(3)
export const bob = seedKey(4)

export const EASY_TARGET = MAX_TARGET >> 6n // ~64 hashes per block

export const genesis: GenesisConfig = {
  chainId: 'isfcr-test',
  timestamp: 1_700_000_000_000,
  faucetAddress: faucet.address,
  faucetAllocation: 200_000n * UNIT,
  instructorAddress: instructor.address,
  initialMode: ConsensusMode.GlobalPoW,
  initialTarget: EASY_TARGET,
}

export function freshState(): ChainState {
  return genesisState(genesis)
}

export function tx(from: KeyPair, nonce: number, body: TxBody, fee = UNIT / 10n): SignedTx {
  return signTx({ chainId: genesis.chainId, nonce, fee, body }, from.privateKey, from.publicKey)
}

export function mine(block: Block): Block {
  const r = mineRange(block.header, 0n, 1_000_000)
  if (!r) throw new Error('failed to mine')
  return { ...block, header: { ...block.header, nonce: r.nonce } }
}

/** Builds, mines and applies a block; timestamps advance 15 s per block by default. */
export function extend(s: ChainState, txs: SignedTx[] = [], proposer = alice.address, dt = 15_000): { state: ChainState; block: Block } {
  const ts = s.recentTimestamps[s.recentTimestamps.length - 1] + dt
  const block = mine(buildBlockTemplate(s, proposer, txs, ts))
  return { state: applyBlock(s, block), block }
}
