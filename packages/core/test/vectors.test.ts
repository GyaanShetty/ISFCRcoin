import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  TxType, UNIT, blockToJSON, bytesToHex, computeMerkleRoot, encodeHeader, encodeTx, headerHash,
  txHash, txSigningBytes,
} from '../src'
import { alice, extend, faucet, freshState, tx } from './helpers'

// Golden vectors shared with the Python CLI. Regenerate with UPDATE_VECTORS=1 only
// when the protocol is intentionally changed.
const path = fileURLToPath(new URL('../../../test-vectors/core.json', import.meta.url))

function build() {
  const t = tx(faucet, 0, { type: TxType.Transfer, to: alice.address, amount: 100n * UNIT })
  const { block } = extend(freshState(), [t])
  return {
    keys: { faucetSeed: '01'.repeat(32), faucetPublicKey: bytesToHex(faucet.publicKey), faucetAddress: faucet.address },
    tx: {
      json: blockToJSON(block).txs[1],
      signingBytes: bytesToHex(txSigningBytes(t)),
      encoded: bytesToHex(encodeTx(t)),
      hash: bytesToHex(txHash(t)),
    },
    block: {
      json: blockToJSON(block),
      merkleRoot: bytesToHex(computeMerkleRoot(block.txs)),
      headerBytes: bytesToHex(encodeHeader(block.header)),
      hash: bytesToHex(headerHash(block.header)),
    },
  }
}

describe('test vectors', () => {
  it('match the committed golden file', () => {
    const v = build()
    if (process.env.UPDATE_VECTORS || !existsSync(path)) writeFileSync(path, JSON.stringify(v, null, 2) + '\n')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(JSON.parse(JSON.stringify(v)))
  })
})
