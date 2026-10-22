import { type BlockHeader, headerPrefixBytes } from '../block'
import { Writer, concatBytes } from '../bytes'
import { addressFromPublicKey, sign, verify } from '../keys'
import { ConsensusMode } from '../params'
import { posRound } from './pos'
import { type Consensus, ValidationError } from './types'

/**
 * Host-attested modes: Proof of Knowledge, Quiz-to-Vote, Proof of Presence,
 * Proof of Peer Vouching and Simulated PoET. Each runs a game on the host
 * (question bank, rotating QR code, timer, votes) that picks the slot's winner.
 * The host signs a certificate naming the winner, and the winner signs the
 * block. Trusting the host is deliberate: it shows where trust hides.
 *
 * proof = hostPub[32] | hostSig[64] | evidence[32] | winnerPub[32] | blockSig[64]
 * The certificate is the first 128 bytes; `evidence` commits to how the winner
 * was chosen (e.g. the question and answer commitments, or the QR nonce).
 */
export const HOST_ATTESTED_MODES = [
  ConsensusMode.PoK, ConsensusMode.QtV, ConsensusMode.PoP, ConsensusMode.PoV, ConsensusMode.PoET,
] as const

const CERT_LEN = 128
const PROOF_LEN = 224

/** What a player signs for each game action (answer, vote, check-in), so nobody can act for someone else. */
export function actionBytes(chainId: string, height: number, action: string, body: Record<string, unknown>): Uint8Array {
  return new Writer().str('ISFCR-ACT').str(chainId).u64(height).str(action).str(JSON.stringify(body)).bytes()
}

export function certBytes(chainId: string, height: number, prevHash: Uint8Array, proposer: string, mode: ConsensusMode, evidence: Uint8Array): Uint8Array {
  return new Writer().str('ISFCR-CERT').str(chainId).u64(height).fixed(prevHash, 32).str(proposer).u8(mode).fixed(evidence, 32).bytes()
}

/** Host side: certificate saying `proposer` won slot `height` under `mode`. */
export function issueCert(
  chainId: string, height: number, prevHash: Uint8Array, proposer: string, mode: ConsensusMode, evidence: Uint8Array,
  hostPriv: Uint8Array, hostPub: Uint8Array,
): Uint8Array {
  return concatBytes(hostPub, sign(certBytes(chainId, height, prevHash, proposer, mode, evidence), hostPriv), evidence)
}

function signingBytes(h: BlockHeader, cert: Uint8Array): Uint8Array {
  return new Writer().str('ISFCR-HOSTBLOCK').raw(headerPrefixBytes({ ...h, proof: cert })).bytes()
}

/** Winner side: sign a template that carries the host's certificate. */
export function sealHostBlock(h: BlockHeader, cert: Uint8Array, priv: Uint8Array, pub: Uint8Array): BlockHeader {
  return { ...h, proof: concatBytes(cert, pub, sign(signingBytes(h, cert), priv)) }
}

function validator(mode: ConsensusMode, name: string): Consensus {
  return {
    mode,
    name,
    slotting: 'slotted',
    validateProof(header, parent) {
      if (header.nonce !== 0n) throw new ValidationError(`${name} blocks have no nonce`)
      const parentTs = parent.recentTimestamps[parent.recentTimestamps.length - 1]
      if (posRound(parentTs, header.timestamp) < 0) throw new ValidationError('too early: the slot has not opened')
      if (header.proof.length !== PROOF_LEN) throw new ValidationError(`${name} proof must be ${PROOF_LEN} bytes`)
      const p = header.proof
      const hostPub = p.slice(0, 32)
      const hostSig = p.slice(32, 96)
      const evidence = p.slice(96, 128)
      const pub = p.slice(128, 160)
      const blockSig = p.slice(160)
      if (addressFromPublicKey(hostPub) !== parent.genesis.instructorAddress) throw new ValidationError('certificate not signed by the host')
      if (!verify(hostSig, certBytes(parent.genesis.chainId, header.height, header.prevHash, header.proposer, mode, evidence), hostPub)) {
        throw new ValidationError('bad host certificate')
      }
      if (addressFromPublicKey(pub) !== header.proposer) throw new ValidationError('block not signed by the certified winner')
      if (!verify(blockSig, signingBytes(header, p.slice(0, CERT_LEN)), pub)) throw new ValidationError('bad block signature')
    },
  }
}

export const proofOfKnowledge = validator(ConsensusMode.PoK, 'Proof of Knowledge')
export const quizToVote = validator(ConsensusMode.QtV, 'Quiz-to-Vote')
export const proofOfPresence = validator(ConsensusMode.PoP, 'Proof of Presence')
export const proofOfVouching = validator(ConsensusMode.PoV, 'Proof of Peer Vouching')
export const simulatedPoET = validator(ConsensusMode.PoET, 'Simulated PoET')
