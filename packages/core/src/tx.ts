import { Writer, bytesToHex, hexToBytes } from './bytes'
import { sha256, type Hash } from './hash'
import { type Address, addressFromPublicKey, addressToBytes, sign, verify } from './keys'
import { ConsensusMode } from './params'

export enum TxType {
  Coinbase = 0,
  Transfer = 1,
  Stake = 2,
  Unstake = 3,
  ProposeConsensus = 4,
  Vote = 5,
  /** Evidence that a PoS proposer signed two different blocks at one height. */
  Slash = 6,
}

export type TxBody =
  | { type: TxType.Transfer; to: Address; amount: bigint }
  | { type: TxType.Stake; amount: bigint }
  | { type: TxType.Unstake; amount: bigint }
  | { type: TxType.ProposeConsensus; mode: ConsensusMode; activateAt: number }
  | { type: TxType.Vote; proposalId: string; approve: boolean }
  | { type: TxType.Slash; headerA: Uint8Array; headerB: Uint8Array }

export interface SignedTx {
  chainId: string
  publicKey: Uint8Array
  nonce: number // per-sender sequence, starts at 0
  fee: bigint
  body: TxBody
  signature: Uint8Array
}

/** Block reward + fees paid to the proposer. Unsigned, always the first tx of a block. */
export interface CoinbaseTx {
  type: TxType.Coinbase
  height: number
  to: Address
  amount: bigint
}

export type Tx = SignedTx | CoinbaseTx

export function isCoinbase(tx: Tx): tx is CoinbaseTx {
  return (tx as CoinbaseTx).type === TxType.Coinbase
}

export function txSender(tx: SignedTx): Address {
  return addressFromPublicKey(tx.publicKey)
}

function writeBody(w: Writer, body: TxBody): void {
  w.u8(body.type)
  switch (body.type) {
    case TxType.Transfer:
      w.fixed(addressToBytes(body.to), 20).u64(body.amount)
      break
    case TxType.Stake:
    case TxType.Unstake:
      w.u64(body.amount)
      break
    case TxType.ProposeConsensus:
      w.u8(body.mode).u64(body.activateAt)
      break
    case TxType.Vote:
      w.fixed(hexToBytes(body.proposalId), 32).u8(body.approve ? 1 : 0)
      break
    case TxType.Slash:
      w.varBytes(body.headerA).varBytes(body.headerB)
      break
  }
}

/** The exact bytes a sender signs. */
export function txSigningBytes(tx: Omit<SignedTx, 'signature'>): Uint8Array {
  const w = new Writer().str('ISFCR-TX').str(tx.chainId).fixed(tx.publicKey, 32).u64(tx.nonce).u64(tx.fee)
  writeBody(w, tx.body)
  return w.bytes()
}

export function encodeTx(tx: Tx): Uint8Array {
  if (isCoinbase(tx)) {
    return new Writer().u8(TxType.Coinbase).u64(tx.height).fixed(addressToBytes(tx.to), 20).u64(tx.amount).bytes()
  }
  return new Writer().raw(txSigningBytes(tx)).fixed(tx.signature, 64).bytes()
}

export function txHash(tx: Tx): Hash {
  return sha256(encodeTx(tx))
}

export function txId(tx: Tx): string {
  return bytesToHex(txHash(tx))
}

export function signTx(unsigned: Omit<SignedTx, 'signature' | 'publicKey'>, privateKey: Uint8Array, publicKey: Uint8Array): SignedTx {
  const base = { ...unsigned, publicKey }
  return { ...base, signature: sign(txSigningBytes(base), privateKey) }
}

// Ed25519 verification dominates block-template building, and the same tx objects are
// checked again and again (mempool admission, every template, the block itself).
// Tx objects are never mutated after signing, so a verified one can be remembered.
const verified = new WeakSet<SignedTx>()

export function verifyTxSignature(tx: SignedTx): boolean {
  if (verified.has(tx)) return true
  const ok = verify(tx.signature, txSigningBytes(tx), tx.publicKey)
  if (ok) verified.add(tx)
  return ok
}

// ---- JSON wire format (bigint -> decimal string, bytes -> hex) ----

export type TxJSON = Record<string, unknown>

export function txToJSON(tx: Tx): TxJSON {
  if (isCoinbase(tx)) return { type: tx.type, height: tx.height, to: tx.to, amount: tx.amount.toString() }
  const body: Record<string, unknown> = { ...tx.body }
  if ('amount' in tx.body) body.amount = tx.body.amount.toString()
  if (tx.body.type === TxType.Slash) {
    body.headerA = bytesToHex(tx.body.headerA)
    body.headerB = bytesToHex(tx.body.headerB)
  }
  return {
    chainId: tx.chainId,
    publicKey: bytesToHex(tx.publicKey),
    nonce: tx.nonce,
    fee: tx.fee.toString(),
    body,
    signature: bytesToHex(tx.signature),
  }
}

export function txFromJSON(j: any): Tx {
  if (j.type === TxType.Coinbase) {
    return { type: TxType.Coinbase, height: Number(j.height), to: j.to, amount: BigInt(j.amount) }
  }
  const b = j.body
  let body: TxBody
  switch (b.type) {
    case TxType.Transfer:
      body = { type: b.type, to: String(b.to), amount: BigInt(b.amount) }
      break
    case TxType.Stake:
    case TxType.Unstake:
      body = { type: b.type, amount: BigInt(b.amount) }
      break
    case TxType.ProposeConsensus:
      body = { type: b.type, mode: Number(b.mode), activateAt: Number(b.activateAt) }
      break
    case TxType.Vote:
      body = { type: b.type, proposalId: String(b.proposalId), approve: Boolean(b.approve) }
      break
    case TxType.Slash:
      body = { type: b.type, headerA: hexToBytes(b.headerA), headerB: hexToBytes(b.headerB) }
      break
    default:
      throw new Error(`unknown tx type ${b.type}`)
  }
  return {
    chainId: String(j.chainId),
    publicKey: hexToBytes(j.publicKey),
    nonce: Number(j.nonce),
    fee: BigInt(j.fee),
    body,
    signature: hexToBytes(j.signature),
  }
}
