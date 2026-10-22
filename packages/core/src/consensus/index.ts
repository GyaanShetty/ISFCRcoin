import { ConsensusMode } from '../params'
import { dynamicPoW } from './dynamicPow'
import { globalPoW } from './pow'
import { proofOfStake } from './pos'
import { vrfLottery } from './vrf'
import { proofOfKnowledge, proofOfPresence, proofOfVouching, quizToVote, simulatedPoET } from './hostAttested'
import type { Consensus } from './types'

export * from './types'
export * from './pow'
export * from './dynamicPow'
export * from './pos'
export * from './vrf'
export * from './hostAttested'

const registry = new Map<ConsensusMode, Consensus>([
  [ConsensusMode.GlobalPoW, globalPoW],
  [ConsensusMode.DynamicPoW, dynamicPoW],
  [ConsensusMode.PoS, proofOfStake],
  [ConsensusMode.VRFLottery, vrfLottery],
  [ConsensusMode.PoK, proofOfKnowledge],
  [ConsensusMode.QtV, quizToVote],
  [ConsensusMode.PoP, proofOfPresence],
  [ConsensusMode.PoV, proofOfVouching],
  [ConsensusMode.PoET, simulatedPoET],
])

export function registerConsensus(c: Consensus): void {
  registry.set(c.mode, c)
}

export function getConsensus(mode: ConsensusMode): Consensus {
  const c = registry.get(mode)
  if (!c) throw new Error(`consensus mode ${ConsensusMode[mode] ?? mode} not implemented`)
  return c
}

export function implementedModes(): ConsensusMode[] {
  return [...registry.keys()]
}
