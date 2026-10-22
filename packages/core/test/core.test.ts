import { describe, expect, it } from 'vitest'
import {
  type Block, ConsensusMode, MAX_TARGET, PARAMS, TxType, UNIT, ValidationError, mineWithShares, signTicket, workForTarget, posLeader, roundOpensAt, sealPosHeader, signAttestation,
  decodePosProof, encodePosProof, attestedShare, encodeHeader, decodeHeader, drawTicket, sealVrfHeader, ticketValue, concatBytes, issueCert, sealHostBlock, applyBlock, blockFromJSON, blockReward,
  blockToJSON, buildBlockTemplate, bytesToHex, computeMerkleRoot, expectedMode, formatISFCR,
  getAccount, headerHash, merkleProof, merkleRoot, parseISFCR, sha256, txFromJSON, txHash, txToJSON,
  utf8ToBytes, verifyMerkleProof, verifyTxSignature,
} from '../src'
import { alice, bob, extend, faucet, freshState, instructor, mine, seedKey, tx } from './helpers'

const fund = (to = alice.address, amount = 100n * UNIT, nonce = 0) =>
  tx(faucet, nonce, { type: TxType.Transfer, to, amount })

describe('amounts', () => {
  it('formats and parses without floats', () => {
    expect(formatISFCR(10n * UNIT)).toBe('10')
    expect(formatISFCR(UNIT / 10n)).toBe('0.1')
    expect(parseISFCR('0.1')).toBe(PARAMS.MIN_FEE)
    expect(parseISFCR('12.345678')).toBe(12_345_678n)
    expect(() => parseISFCR('1.2345678')).toThrow()
  })

  it('halves the reward every 100 blocks', () => {
    expect(blockReward(1)).toBe(10n * UNIT)
    expect(blockReward(99)).toBe(10n * UNIT)
    expect(blockReward(100)).toBe(5n * UNIT)
    expect(blockReward(250)).toBe(UNIT * 10n / 4n)
  })
})

describe('transactions', () => {
  it('signs, verifies and detects tampering', () => {
    const t = fund()
    expect(verifyTxSignature(t)).toBe(true)
    const tampered = { ...t, body: { ...t.body, amount: 1000n * UNIT } as typeof t.body }
    expect(verifyTxSignature(tampered)).toBe(false)
  })

  it('round-trips through JSON with identical hash', () => {
    const t = fund()
    const back = txFromJSON(JSON.parse(JSON.stringify(txToJSON(t))))
    expect(bytesToHex(txHash(back))).toBe(bytesToHex(txHash(t)))
  })
})

describe('merkle', () => {
  it('proves inclusion for every leaf, odd counts included', () => {
    const leaves = [1, 2, 3, 4, 5].map((i) => sha256(utf8ToBytes(String(i))))
    const root = merkleRoot(leaves)
    leaves.forEach((leaf, i) => expect(verifyMerkleProof(leaf, merkleProof(leaves, i), root)).toBe(true))
    expect(verifyMerkleProof(leaves[0], merkleProof(leaves, 1), root)).toBe(false)
  })
})

describe('blocks', () => {
  it('mines a block, pays reward + fees to the proposer', () => {
    const { state } = extend(freshState(), [fund()])
    expect(state.height).toBe(1)
    expect(getAccount(state, alice.address).balance).toBe(100n * UNIT + 10n * UNIT + UNIT / 10n)
    expect(getAccount(state, faucet.address).nonce).toBe(1)
  })

  it('round-trips a block through JSON', () => {
    const { block } = extend(freshState(), [fund()])
    const back = blockFromJSON(JSON.parse(JSON.stringify(blockToJSON(block))))
    expect(bytesToHex(headerHash(back.header))).toBe(bytesToHex(headerHash(block.header)))
    expect(() => applyBlock(freshState(), back)).not.toThrow()
  })

  const rejects = (name: string, mutate: (b: ReturnType<typeof buildBlockTemplate>) => void, txs = [fund()]) =>
    it(`rejects ${name}`, () => {
      const s = freshState()
      const tpl = buildBlockTemplate(s, alice.address, txs, s.genesis.timestamp + 15_000)
      mutate(tpl)
      expect(() => applyBlock(s, mine(tpl))).toThrow(ValidationError)
    })

  rejects('a wrong prevHash', (b) => { b.header.prevHash = sha256(utf8ToBytes('x')) })
  rejects('a bad merkle root', (b) => { b.header.merkleRoot = sha256(utf8ToBytes('x')) })
  rejects('an inflated coinbase', (b) => {
    const cb = b.txs[0] as any
    cb.amount += 1n
    b.header.merkleRoot = computeMerkleRoot(b.txs)
  })
  rejects('a fee below minimum', () => {}, [tx(faucet, 0, { type: TxType.Transfer, to: alice.address, amount: UNIT }, 1n)])
  rejects('a replayed nonce', () => {}, [fund(alice.address, UNIT, 0), fund(bob.address, UNIT, 0)])
  rejects('an overspend', () => {}, [tx(alice, 0, { type: TxType.Transfer, to: bob.address, amount: UNIT })])
  rejects('too many txs', (b) => {
    // The template builder caps the list, so push past the limit by hand.
    b.txs.push(fund(bob.address, UNIT, b.txs.length - 1))
    b.header.merkleRoot = computeMerkleRoot(b.txs)
  }, Array.from({ length: PARAMS.MAX_TXS_PER_BLOCK }, (_, i) => fund(bob.address, UNIT, i)))

  it('rejects an unmined block', () => {
    const s = freshState()
    const tpl = buildBlockTemplate(s, alice.address, [], s.genesis.timestamp + 15_000)
    tpl.header.nonce = 0n
    // Find a nonce that does NOT meet the target.
    while (BigInt('0x' + bytesToHex(headerHash(tpl.header))) <= s.target) tpl.header.nonce++
    expect(() => applyBlock(s, tpl)).toThrow(/target/)
  })

  it('editing one old transaction breaks every later block', () => {
    let s = freshState()
    const blocks: Block[] = []
    for (let i = 0; i < 3; i++) {
      const r = extend(s, [fund(alice.address, UNIT, i)])
      s = r.state
      blocks.push(r.block)
    }
    const t = blocks[0].txs[1] as any
    t.body.amount = 999n * UNIT
    // Block 0's merkle root no longer matches, and its hash (block 1's prevHash) would change if fixed.
    expect(() => applyBlock(freshState(), blocks[0])).toThrow(/merkle/)
  })
})

describe('difficulty', () => {
  it('lowers the target when blocks come too fast', () => {
    let s = freshState()
    const start = s.target
    for (let i = 0; i < 5; i++) s = extend(s, [], alice.address, 3_000).state
    expect(s.target < start).toBe(true)
  })

  it('raises the target when blocks come too slowly', () => {
    let s = freshState()
    const start = s.target
    for (let i = 0; i < 5; i++) s = extend(s, [], alice.address, 60_000).state
    expect(s.target > start).toBe(true)
  })
})

describe('staking', () => {
  it('moves coins between balance and stake', () => {
    let s = extend(freshState(), [fund()]).state
    s = extend(s, [tx(alice, 0, { type: TxType.Stake, amount: 40n * UNIT })], bob.address).state
    expect(getAccount(s, alice.address).stake).toBe(40n * UNIT)
    s = extend(s, [tx(alice, 1, { type: TxType.Unstake, amount: 15n * UNIT })], bob.address).state
    expect(getAccount(s, alice.address).stake).toBe(25n * UNIT)
  })
})

describe('governance', () => {
  it('instructor proposal schedules the switch and the block at activateAt must use the new mode', () => {
    let s = extend(freshState(), [fund(instructor.address, UNIT)]).state
    const propose = tx(instructor, 0, { type: TxType.ProposeConsensus, mode: ConsensusMode.PoS, activateAt: s.height + 3 })
    s = extend(s, [propose]).state
    expect(s.scheduledSwitch?.mode).toBe(ConsensusMode.PoS)
    expect(expectedMode(s, s.height + 1)).toBe(ConsensusMode.GlobalPoW)
    s = extend(s).state
    expect(expectedMode(s, s.height + 1)).toBe(ConsensusMode.PoS)
    // A PoW block at the activation height is rejected.
    const tpl = buildBlockTemplate(s, alice.address, [], s.recentTimestamps.at(-1)! + 15_000)
    tpl.header.mode = ConsensusMode.GlobalPoW
    expect(() => applyBlock(s, mine(tpl))).toThrow(/wrong consensus mode/)
    // ...unless the node is deliberately running the old rules (fork demo).
    expect(() => applyBlock(s, mine(tpl), { ignoreGovernance: true })).not.toThrow()
  })

  it('holder proposals pass at 50% of circulating supply', () => {
    const carol = seedKey(5)
    let s = extend(freshState(), [fund(alice.address, 100n * UNIT, 0), fund(bob.address, 100n * UNIT, 1)], carol.address).state
    // circulating: alice 100, bob 100, carol 10.2 (reward + fees); instructor and faucet don't count
    const propose = tx(alice, 0, { type: TxType.ProposeConsensus, mode: ConsensusMode.PoS, activateAt: s.height + 10 })
    s = extend(s, [propose], carol.address).state
    const pid = [...s.proposals.keys()][0]
    expect(s.proposals.get(pid)!.passed).toBe(false)
    s = extend(s, [tx(bob, 0, { type: TxType.Vote, proposalId: pid, approve: true })], carol.address).state
    expect(s.proposals.get(pid)!.passed).toBe(true)
  })

  it('rejects double votes', () => {
    let s = extend(freshState(), [fund(alice.address, 100n * UNIT, 0), fund(bob.address, 1n * UNIT, 1)]).state
    s = extend(s, [tx(bob, 0, { type: TxType.ProposeConsensus, mode: ConsensusMode.PoS, activateAt: 50 })], instructor.address).state
    const pid = [...s.proposals.keys()][0]
    expect(() => extend(s, [tx(bob, 1, { type: TxType.Vote, proposalId: pid, approve: true })], instructor.address)).toThrow(/already voted/)
  })
})

describe('dynamic PoW', () => {
  const setup = () => {
    let s = extend(freshState(), [fund(instructor.address, UNIT)]).state
    s = extend(s, [tx(instructor, 0, { type: TxType.ProposeConsensus, mode: ConsensusMode.DynamicPoW, activateAt: s.height + 3 })]).state
    return extend(s).state // next block is the first Dynamic PoW block
  }
  const dynBlock = (s: ReturnType<typeof setup>, target: bigint, signer = instructor) => {
    const tpl = buildBlockTemplate(s, alice.address, [], s.recentTimestamps.at(-1)! + 15_000)
    tpl.header.target = target
    tpl.header.proof = signTicket(s.genesis.chainId, tpl.header.height, alice.address, target, signer.privateKey, signer.publicKey)
    return mine(tpl)
  }

  it('accepts a block mined at its host-signed per-miner target', () => {
    const s = setup()
    expect(expectedMode(s, s.height + 1)).toBe(ConsensusMode.DynamicPoW)
    const easy = MAX_TARGET >> 4n
    const next = applyBlock(s, dynBlock(s, easy))
    expect(next.height).toBe(s.height + 1)
    // Fork weight uses the network target, not the miner's easy one.
    expect(next.totalWork - s.totalWork).toBe(workForTarget(s.target))
  })

  it('rejects a ticket signed by anyone but the host', () => {
    const s = setup()
    expect(() => applyBlock(s, dynBlock(s, MAX_TARGET >> 4n, bob))).toThrow(/host key/)
  })

  it('rejects a miner who raises their own target after signing', () => {
    const s = setup()
    const b = dynBlock(s, MAX_TARGET >> 8n)
    b.header.target = MAX_TARGET >> 2n // easier than the host granted
    expect(() => applyBlock(s, mine(b))).toThrow(/signature/)
  })

  it('collects shares while mining', () => {
    const s = freshState()
    const tpl = buildBlockTemplate(s, alice.address, [], s.genesis.timestamp + 1)
    tpl.header.target = 0n // never finds a block
    const r = mineWithShares(tpl.header, 0n, 20_000, MAX_TARGET >> 8n)
    expect(r.found).toBeNull()
    expect(r.shares.length).toBeGreaterThan(30) // expect ~78
  })
})

describe('proof of stake', () => {
  // alice stakes 90, bob stakes 10; then the chain switches to PoS.
  const setup = () => {
    let s = extend(freshState(), [fund(alice.address, 100n * UNIT, 0), fund(bob.address, 100n * UNIT, 1), fund(instructor.address, UNIT, 2)]).state
    s = extend(s, [
      tx(alice, 0, { type: TxType.Stake, amount: 90n * UNIT }),
      tx(bob, 0, { type: TxType.Stake, amount: 10n * UNIT }),
      tx(instructor, 0, { type: TxType.ProposeConsensus, mode: ConsensusMode.PoS, activateAt: s.height + 3 }),
    ]).state
    return extend(s).state
  }
  const keyOf = (addr: string) => [alice, bob].find((k) => k.address === addr)!
  const posBlock = (s: ReturnType<typeof setup>, round = 0, txs: any[] = [], dt = 0) => {
    const leader = posLeader(s, round)!
    const ts = roundOpensAt(s.recentTimestamps.at(-1)!, round) + dt
    const tpl = buildBlockTemplate(s, leader, txs, ts)
    const k = keyOf(leader)
    return { ...tpl, header: sealPosHeader(tpl.header, k.privateKey, k.publicKey) }
  }

  it('picks proposers in proportion to stake, reproducibly', () => {
    const s = setup()
    expect(expectedMode(s, s.height + 1)).toBe(ConsensusMode.PoS)
    const picks = Array.from({ length: 400 }, (_, r) => posLeader(s, r))
    const aliceShare = picks.filter((p) => p === alice.address).length / picks.length
    expect(aliceShare).toBeGreaterThan(0.82)
    expect(aliceShare).toBeLessThan(0.97)
    expect(posLeader(s, 7)).toBe(posLeader(s, 7))
  })

  it('accepts the round leader and rejects everyone else', () => {
    const s = setup()
    const good = posBlock(s)
    expect(applyBlock(s, good).height).toBe(s.height + 1)
    const impostor = good.header.proposer === alice.address ? bob : alice
    const tpl = buildBlockTemplate(s, impostor.address, [], good.header.timestamp)
    const bad = { ...tpl, header: sealPosHeader(tpl.header, impostor.privateKey, impostor.publicKey) }
    expect(() => applyBlock(s, bad)).toThrow(/not the proposer/)
  })

  it('rejects a block before its slot opens', () => {
    const s = setup()
    const b = posBlock(s)
    b.header.timestamp -= 1
    const k = keyOf(b.header.proposer)
    expect(() => applyBlock(s, { ...b, header: sealPosHeader(b.header, k.privateKey, k.publicKey) })).toThrow(/too early/)
  })

  it('lets the next round take over when a proposer is absent', () => {
    const s = setup()
    const r = [1, 2, 3, 4, 5].find((n) => posLeader(s, n) !== posLeader(s, 0)) ?? 1
    expect(applyBlock(s, posBlock(s, r)).height).toBe(s.height + 1)
  })

  it('bundles attestations from stakers', () => {
    const s = setup()
    const b = posBlock(s)
    const atts = [alice, bob].map((k) => signAttestation(s.genesis.chainId, s.tipHash, k.privateKey, k.publicKey))
    const sealed = decodePosProof(b.header.proof)
    b.header.proof = encodePosProof(sealed.publicKey, sealed.signature, atts)
    expect(applyBlock(s, b).height).toBe(s.height + 1)
    expect(attestedShare(b.header, s)).toBe(1)
    const fake = signAttestation(s.genesis.chainId, s.tipHash, instructor.privateKey, instructor.publicKey)
    b.header.proof = encodePosProof(sealed.publicKey, sealed.signature, [fake])
    expect(() => applyBlock(s, b)).toThrow(/non-staker/)
  })

  it('slashes a proposer who signs two blocks at one height', () => {
    const s = setup()
    const a = posBlock(s, 0, [], 0)
    const c = posBlock(s, 0, [], 1) // same slot, different timestamp: a different block
    const cheater = a.header.proposer
    const before = getAccount(s, cheater).stake
    let next = applyBlock(s, a)
    const reporter = cheater === alice.address ? bob : alice
    const evidence = tx(reporter, getAccount(next, reporter.address).nonce, { type: TxType.Slash, headerA: encodeHeader(a.header), headerB: encodeHeader(c.header) })
    next = applyBlock(next, posBlock(next, 0, [evidence]))
    expect(getAccount(next, cheater).stake).toBe(before - before / 2n)
    // The same evidence can't be used twice.
    const again = tx(reporter, getAccount(next, reporter.address).nonce, { type: TxType.Slash, headerA: encodeHeader(a.header), headerB: encodeHeader(c.header) })
    expect(() => applyBlock(next, posBlock(next, 0, [again]))).toThrow(/already slashed/)
  })

  it('round-trips a header through decodeHeader', () => {
    const b = posBlock(setup())
    expect(bytesToHex(headerHash(decodeHeader(encodeHeader(b.header))))).toBe(bytesToHex(headerHash(b.header)))
  })
})

describe('VRF lottery', () => {
  const setup = () => {
    let s = extend(freshState(), [fund(alice.address, 10n * UNIT, 0), fund(bob.address, 10n * UNIT, 1), fund(instructor.address, UNIT, 2)]).state
    s = extend(s, [tx(instructor, 0, { type: TxType.ProposeConsensus, mode: ConsensusMode.VRFLottery, activateAt: s.height + 2 })]).state
    return s
  }
  const lotteryBlock = (s: ReturnType<typeof setup>, who: typeof alice) => {
    const ts = s.recentTimestamps.at(-1)! + 15_000
    const tpl = buildBlockTemplate(s, who.address, [], ts)
    const ticket = drawTicket(s.genesis.chainId, s.tipHash, tpl.header.height, who.privateKey)
    return { ...tpl, header: sealVrfHeader(tpl.header, ticket, who.privateKey, who.publicKey) }
  }

  it('tickets are deterministic and differ per address', () => {
    const s = setup()
    const t1 = drawTicket(s.genesis.chainId, s.tipHash, 5, alice.privateKey)
    expect(bytesToHex(t1)).toBe(bytesToHex(drawTicket(s.genesis.chainId, s.tipHash, 5, alice.privateKey)))
    expect(ticketValue(t1)).not.toBe(ticketValue(drawTicket(s.genesis.chainId, s.tipHash, 5, bob.privateKey)))
  })

  it('accepts a registered address and rejects outsiders, stolen tickets and early blocks', () => {
    const s = setup()
    expect(expectedMode(s, s.height + 1)).toBe(ConsensusMode.VRFLottery)
    expect(applyBlock(s, lotteryBlock(s, alice)).height).toBe(s.height + 1)
    const stranger = seedKey(9)
    expect(() => applyBlock(s, lotteryBlock(s, stranger))).toThrow(/registered/)
    // The builder clamps timestamps to the slot opening, so backdate and re-sign by hand.
    const early = lotteryBlock(s, alice)
    const ticket = early.header.proof.slice(32, 96)
    early.header = sealVrfHeader({ ...early.header, timestamp: early.header.timestamp - 1 }, ticket, alice.privateKey, alice.publicKey)
    expect(() => applyBlock(s, early)).toThrow(/too early/)
    // Bob reuses Alice's ticket under his own name.
    const a = lotteryBlock(s, alice)
    const b = lotteryBlock(s, bob)
    b.header.proof = concatBytes(bob.publicKey, a.header.proof.slice(32, 96), b.header.proof.slice(96))
    expect(() => applyBlock(s, b)).toThrow(/ticket/)
  })

  it('fork choice prefers the lower ticket at a height, but never over a longer chain', () => {
    const s = setup()
    const [low, high] = [alice, bob].sort((x, y) => {
      const v = (k: typeof alice) => ticketValue(drawTicket(s.genesis.chainId, s.tipHash, s.height + 1, k.privateKey))
      return v(x) < v(y) ? -1 : 1
    })
    const sLow = applyBlock(s, lotteryBlock(s, low))
    const sHigh = applyBlock(s, lotteryBlock(s, high))
    expect(sLow.totalWork > sHigh.totalWork).toBe(true)
    const longer = applyBlock(sHigh, lotteryBlock(sHigh, high))
    expect(longer.totalWork > sLow.totalWork).toBe(true)
  })
})

describe('host-attested modes', () => {
  const setup = (mode: ConsensusMode) => {
    let s = extend(freshState(), [fund(alice.address, 10n * UNIT, 0), fund(instructor.address, UNIT, 1)]).state
    s = extend(s, [tx(instructor, 0, { type: TxType.ProposeConsensus, mode, activateAt: s.height + 2 })]).state
    return s
  }
  const evidence = sha256(utf8ToBytes('round evidence'))
  const certified = (s: ReturnType<typeof setup>, mode: ConsensusMode, winner = alice, host = instructor) => {
    const tpl = buildBlockTemplate(s, winner.address, [], s.recentTimestamps.at(-1)! + 15_000)
    const cert = issueCert(s.genesis.chainId, tpl.header.height, s.tipHash, winner.address, mode, evidence, host.privateKey, host.publicKey)
    return { ...tpl, header: sealHostBlock(tpl.header, cert, winner.privateKey, winner.publicKey) }
  }

  for (const mode of [ConsensusMode.PoK, ConsensusMode.QtV, ConsensusMode.PoP, ConsensusMode.PoV, ConsensusMode.PoET]) {
    it(`${ConsensusMode[mode]}: accepts the host-certified winner only`, () => {
      const s = setup(mode)
      expect(expectedMode(s, s.height + 1)).toBe(mode)
      expect(applyBlock(s, certified(s, mode)).height).toBe(s.height + 1)
      // A certificate from anyone but the host is worthless.
      expect(() => applyBlock(s, certified(s, mode, alice, bob))).toThrow(/host/)
      // Someone else can't reuse alice's certificate under their own name.
      const b = certified(s, mode)
      const stolen = buildBlockTemplate(s, bob.address, [], b.header.timestamp)
      stolen.header = sealHostBlock(stolen.header, b.header.proof.slice(0, 128), bob.privateKey, bob.publicKey)
      expect(() => applyBlock(s, stolen)).toThrow(/certificate/)
    })
  }

  it('a certificate for one mode does not work in another', () => {
    const s = setup(ConsensusMode.PoK)
    expect(() => applyBlock(s, certified(s, ConsensusMode.PoP))).toThrow(/certificate/)
  })
})
