# ISFCRcoin protocol (v1)

Source of truth: `packages/core`. Golden vectors: `test-vectors/core.json`; any other implementation (e.g. the Python CLI) must reproduce them byte for byte.

## Primitives
- Integers big-endian. `u8`, `u32`, `u64`.
- `var` = `u32` length + bytes. `str` = `var` of UTF-8.
- Hash = SHA-256 (single). Signatures = Ed25519 (RFC 8032).
- Amounts: integer units, 1 ISFCR = 1,000,000. Min fee 100,000.
- Address = `"isfcr1"` + hex(first 20 bytes of SHA-256(pubkey)). On the wire inside bytes: the 20 raw bytes.

## Transactions
Signing bytes:
```
str "ISFCR-TX" | str chainId | pubkey[32] | u64 nonce | u64 fee | u8 type | body
```
| type | body |
|---|---|
| 1 Transfer | to[20] u64 amount |
| 2 Stake | u64 amount |
| 3 Unstake | u64 amount |
| 4 ProposeConsensus | u8 mode, u64 activateAt |
| 5 Vote | proposalId[32] u8 approve |

Encoded signed tx = signing bytes | signature[64]. Coinbase (type 0) = `u8 0 | u64 height | to[20] | u64 amount`. txHash = SHA-256(encoded). Proposal id = txHash of the ProposeConsensus tx.

## Blocks
Header bytes:
```
u8 version | u64 height | prevHash[32] | merkleRoot[32] | u64 timestamp_ms | u8 mode |
proposer[20] | target[32] | var proof | u64 nonce
```
Block hash = SHA-256(header bytes). The nonce is last so miners can rewrite just 8 bytes.
Merkle root: tx hashes paired level by level, the last one duplicated on odd levels; empty list → 32 zero bytes. txs[0] is always the coinbase.

PoW validity: `hash as big-endian uint256 <= target`.

## Consensus modes
`0 GlobalPoW, 1 DynamicPoW, 2 PoS, 3 VRFLottery, 4 PoK, 5 QtV, 6 PoP, 7 PoV, 8 PoET`

## Rules
- Reward 10 ISFCR, halving every 100 blocks, capped by supply (1,000,000 ISFCR including the genesis faucet and instructor allocations). Coinbase = reward + fees, paid to `proposer`.
- Max 20 non-coinbase txs per block. Sender nonce must equal the account's nonce.
- Global PoW retarget each block toward 15 s over the last 10 blocks, moving 1/4 of the way, clamped to ×0.5–×2.
- Governance: a ProposeConsensus from the instructor address passes immediately. Otherwise it passes once "for" votes (weighted by balance+stake) reach 50% of circulating supply (faucet and instructor accounts excluded) before `activateAt`. The block at `activateAt` must carry the new mode.

## Block proofs by mode
`header.proof` (and `target`/`nonce`) depend on the mode. Slotted modes (everything except the two PoW modes) need `timestamp >= parent timestamp + 15 s` and `nonce = 0`.

| Mode | proof | Checked |
|---|---|---|
| GlobalPoW | empty | `hash <= target`, target = network target |
| DynamicPoW | hostPub[32] \| sig[64] over `str "ISFCR-DIFF" \| str chainId \| u64 height \| proposer[20] \| target[32]` | host = instructor key; `hash <= target` |
| PoS | pub[32] \| sig[64] \| u32 n \| n × (pub[32] \| sig[64]) | proposer = stake-weighted pick for the round (seed `sha256(str "ISFCR-LEADER" \| parentHash \| u64 height \| u32 round)`); sig over `str "ISFCR-POS" \| headerPrefix(proof = empty)`; attestations sign `str "ISFCR-ATTEST" \| str chainId \| parentHash` |
| VRFLottery | pub[32] \| ticket[64] \| blockSig[64] | ticket = sig over `str "ISFCR-VRF" \| str chainId \| parentHash \| u64 height`; lower `sha256(ticket)` wins fork choice; blockSig over `str "ISFCR-VRFBLOCK" \| headerPrefix(proof = empty)` |
| PoK, QtV, PoP, PoV, PoET | hostPub[32] \| hostSig[64] \| evidence[32] \| pub[32] \| blockSig[64] | host cert over `str "ISFCR-CERT" \| str chainId \| u64 height \| parentHash \| str proposer \| u8 mode \| evidence[32]`; blockSig over `str "ISFCR-HOSTBLOCK" \| headerPrefix(proof = first 128 bytes)` |

Game actions in the host-run modes are signed as `str "ISFCR-ACT" | str chainId | u64 height | str action | str JSON(body)`.
`Slash` (tx type 6): `var headerA | var headerB`, two PoS headers from one proposer at one height; half the offender's stake is burned and the reporter gets a tenth of it.
