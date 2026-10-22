import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type Block, ConsensusMode, TxType, UNIT, blockFromJSON, blockToJSON, buildBlockTemplate, bytesToHex, headerHash,
  SHARE_TARGET, generateKeyPair, mineRange, signTx, txToJSON, sealPosHeader, signAttestation, hexToBytes,
  decodePosProof, expectedMode, drawTicket, sealVrfHeader, sealHostBlock, sign, sha256, Writer, actionBytes,
} from '@isfcr/core'
import type { FastifyInstance } from 'fastify'
import { buildApi } from '../src/api'
import { loadConfig } from '../src/config'
import { Peer } from '../src/gossip'
import { IsfcrNode } from '../src/node'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

async function setup(env: Record<string, string> = {}) {
  const { config } = loadConfig({ DB_PATH: ':memory:', TXGEN: '0', INITIAL_WORK: '16', OPEN_JOIN: '1', ...env })
  const node = new IsfcrNode(config)
  node.start()
  const app = await buildApi(node)
  cleanups.push(async () => {
    await app.close()
    node.close()
  })
  return { node, app }
}

const json = async (app: FastifyInstance, method: 'GET' | 'POST', url: string, payload?: unknown, headers = {}) => {
  const res = await app.inject({ method, url, payload: payload as any, headers })
  return { status: res.statusCode, body: res.json() }
}

function seal(block: Block): Block {
  // Grind until found: Dynamic PoW targets vary, so no fixed try budget is safe.
  for (let start = 0n; ; start += 1_000_000n) {
    const r = mineRange(block.header, start, 1_000_000)
    if (r) {
      block.header.nonce = r.nonce
      return block
    }
  }
}

async function mineVia(app: FastifyInstance, proposer: string, txs?: string[]) {
  const q = txs ? `&txs=${txs.join(',')}` : ''
  const tpl = await json(app, 'GET', `/api/template?proposer=${proposer}${q}`)
  const block = seal(blockFromJSON(tpl.body.block))
  return json(app, 'POST', '/api/block', blockToJSON(block))
}

describe('node API', () => {
  it('join → faucet → mine: coins arrive and the claim cannot repeat', async () => {
    const { app } = await setup()
    const me = generateKeyPair()
    const { body: { token } } = await json(app, 'POST', '/api/join', { code: 'alice' })
    const claim = await json(app, 'POST', '/api/faucet', { token, address: me.address })
    expect(claim.status).toBe(200)
    expect((await json(app, 'POST', '/api/faucet', { token, address: me.address })).body.error).toMatch(/already claimed/)
    expect((await json(app, 'GET', '/api/mempool')).body.size).toBe(1)

    const res = await mineVia(app, me.address)
    expect(res.body.status).toBe('added')
    const st = await json(app, 'GET', `/api/state/${me.address}`)
    // 100 faucet + 10 reward + 1 faucet fee
    expect(BigInt(st.body.balance)).toBe(111n * UNIT)
    expect((await json(app, 'GET', '/api/mempool')).body.size).toBe(0)
  })

  it('lists the chain including genesis', async () => {
    const { app } = await setup()
    await mineVia(app, generateKeyPair().address)
    const r = await json(app, 'GET', '/api/chain?limit=30')
    expect(r.status).toBe(200)
    expect(r.body.map((b: any) => b.height)).toEqual([0, 1])
  })

  it('rejects join codes when open join is off', async () => {
    const { app, node } = await setup({ OPEN_JOIN: '0' })
    expect((await json(app, 'POST', '/api/join', { code: 'nope' })).status).toBe(400)
    const [code] = node.createJoinCodes(1)
    expect((await json(app, 'POST', '/api/join', { code })).status).toBe(200)
  })

  it('templates take the highest fees first, up to the block size limit', async () => {
    const { app, node } = await setup()
    const bots = Array.from({ length: 25 }, () => generateKeyPair())
    for (const b of bots) node.faucetSend(b.address, 5n * UNIT)
    await mineVia(app, bots[0].address)
    await mineVia(app, bots[0].address) // second block: 25 faucet txs > 20 per block
    const state = node.chain.tip.state
    const sink = generateKeyPair().address
    bots.forEach((b, i) => {
      const tx = signTx({ chainId: state.genesis.chainId, nonce: 0, fee: BigInt(i + 1) * (UNIT / 10n), body: { type: TxType.Transfer, to: sink, amount: UNIT } }, b.privateKey, b.publicKey)
      node.submitTx(tx)
    })
    const tpl = await json(app, 'GET', `/api/template?proposer=${sink}`)
    const fees = tpl.body.block.txs.slice(1).map((t: any) => BigInt(t.fee))
    expect(fees.length).toBe(20)
    expect(fees[fees.length - 1]).toBe(6n * (UNIT / 10n)) // the 5 cheapest are left out
  })

  it('rejects bad txs with a reason', async () => {
    const { app, node } = await setup()
    const k = generateKeyPair()
    const tx = signTx({ chainId: node.chain.genesis.chainId, nonce: 0, fee: UNIT / 10n, body: { type: TxType.Transfer, to: k.address, amount: UNIT } }, k.privateKey, k.publicKey)
    const r = await json(app, 'POST', '/api/tx', txToJSON(tx))
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/insufficient/)
  })

  it('forks: a heavier side branch wins and its orphaned txs return to the mempool', async () => {
    const { node } = await setup()
    const a = generateKeyPair()
    const b = generateKeyPair()
    const user = generateKeyPair()
    node.faucetSend(user.address, 10n * UNIT)
    const base = node.chain.tip.state
    const ts = Date.now() // genesis is 'now', so stay within the allowed future drift
    const withTx = seal(buildBlockTemplate(base, a.address, node.mempool.select(base), ts))
    const empty = seal(buildBlockTemplate(base, b.address, [], ts))
    node.submitBlock(withTx)
    expect(node.mempool.size).toBe(0)
    node.submitBlock(empty) // same height, same work: first seen stays tip
    expect(node.chain.tip.block.header.proposer).toBe(a.address)
    // Extend the empty branch: it becomes heavier and the faucet tx must come back.
    const onEmpty = node.chain.get(bytesToHex(headerHash(empty.header)))!
    node.submitBlock(seal(buildBlockTemplate(onEmpty.state, b.address, [], ts + 1)))
    expect(node.chain.tip.block.header.proposer).toBe(b.address)
    expect(node.chain.height).toBe(2)
    expect(node.mempool.size).toBe(1)
  })

  it('admin consensus switch schedules the new mode', async () => {
    const { app, node } = await setup()
    const auth = { authorization: 'Bearer dev-admin' }
    expect((await json(app, 'POST', '/api/admin/consensus', { mode: ConsensusMode.PoS, activateIn: 3 })).status).toBe(401)
    expect((await json(app, 'POST', '/api/admin/consensus', { mode: ConsensusMode.PoS, activateIn: 3 }, auth)).status).toBe(200)
    await mineVia(app, generateKeyPair().address)
    expect(node.chain.tip.state.scheduledSwitch?.mode).toBe(ConsensusMode.PoS)
  })

  it('drops a consensus proposal once its activation height can no longer be met', async () => {
    const { app, node } = await setup()
    node.proposeConsensus(ConsensusMode.DynamicPoW, 3) // activateAt = 3
    expect(node.mempool.size).toBe(1)
    // Two blocks that leave it out (miner picks nothing): next block would be 3, too late.
    await mineVia(app, generateKeyPair().address, [])
    await mineVia(app, generateKeyPair().address, [])
    expect(node.mempool.size).toBe(0)
    expect(() => node.proposeConsensus(ConsensusMode.DynamicPoW, 1)).not.toThrow() // re-proposing uses height + 3
  })

  it('holders vote a switch through and the tally is visible', async () => {
    const { app, node } = await setup()
    const [a, b, c] = [generateKeyPair(), generateKeyPair(), generateKeyPair()]
    for (const k of [a, b, c]) node.faucetSend(k.address, 100n * UNIT)
    await mineVia(app, generateKeyPair().address, undefined)
    const chainId = node.chain.genesis.chainId
    const send = (k: typeof a, nonce: number, body: any) => node.submitTx(signTx({ chainId, nonce, fee: UNIT / 10n, body }, k.privateKey, k.publicKey))
    send(a, 0, { type: TxType.ProposeConsensus, mode: ConsensusMode.PoS, activateAt: node.chain.height + 20 })
    await mineVia(app, generateKeyPair().address)
    let [p] = (await json(app, 'GET', '/api/proposals')).body
    expect(p.open).toBe(true)
    expect(p.passed).toBe(false) // a holds about a third
    send(b, 0, { type: TxType.Vote, proposalId: p.id, approve: true })
    await mineVia(app, generateKeyPair().address)
    ;[p] = (await json(app, 'GET', '/api/proposals')).body
    expect(p.passed).toBe(true)
    expect(p.votesFor).toEqual(expect.arrayContaining([a.address, b.address]))
  })

  it('reset archives the leaderboard and starts a new chain', async () => {
    const { app, node } = await setup()
    const me = generateKeyPair()
    await mineVia(app, me.address)
    const oldChain = node.chain.genesis.chainId
    await json(app, 'POST', '/api/admin/reset', {}, { authorization: 'Bearer dev-admin' })
    expect(node.chain.height).toBe(0)
    expect(node.chain.genesis.chainId).not.toBe(oldChain)
    const sessions = (await json(app, 'GET', '/api/sessions')).body
    expect(sessions[0].leaderboard[0]).toMatchObject({ address: me.address, blocks: 1 })
  })
})

describe('two seed nodes', () => {
  it('a follower adopts the primary genesis and syncs blocks both ways', async () => {
    const A = await setup()
    await A.app.listen({ port: 0, host: '127.0.0.1' })
    const urlA = `http://127.0.0.1:${(A.app.server.address() as any).port}`
    const miner = generateKeyPair()
    await mineVia(A.app, miner.address)
    await mineVia(A.app, miner.address)

    const B = await setup({ FOLLOW_PEER: '1' })
    const peer = new Peer(B.node, urlA)
    cleanups.push(() => peer.close())
    peer.connect()
    await waitFor(() => B.node.chain.height === 2)
    expect(B.node.chain.genesis.chainId).toBe(A.node.chain.genesis.chainId)

    // New block on A arrives at B over the live feed.
    await mineVia(A.app, miner.address)
    await waitFor(() => B.node.chain.height === 3)
    expect(B.node.chain.tip.hash).toBe(A.node.chain.tip.hash)
  })
})

async function waitFor(cond: () => boolean, ms = 5000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('dynamic PoW on the node', () => {
  it('issues per-miner tickets from shares and accepts the resulting blocks', async () => {
    const { app, node } = await setup()
    const auth = { authorization: 'Bearer dev-admin' }
    await json(app, 'POST', '/api/admin/consensus', { mode: ConsensusMode.DynamicPoW, activateIn: 2 }, auth)
    const fast = generateKeyPair()
    const slow = generateKeyPair()
    while (node.chain.tip.state.mode !== ConsensusMode.DynamicPoW) await mineVia(app, fast.address)

    // Fast miner proves 40 shares, slow miner 4: the fast one must get a 10x harder target.
    const shareFor = async (who: string, count: number) => {
      const tpl = blockFromJSON((await json(app, 'GET', `/api/template?proposer=${who}`)).body.block)
      // Shares must be hashes of the exact template header (its ticket and target included).
      const shares: bigint[] = []
      let start = 0n
      while (shares.length < count) {
        const r = mineRange(tpl.header, start, 50_000_000, SHARE_TARGET)!
        shares.push(r.nonce)
        start = r.nonce + 1n
      }
      return json(app, 'POST', '/api/shares', { header: blockToJSON(tpl).header, nonces: shares.map(String) })
    }
    expect((await shareFor(fast.address, 40)).body.accepted).toBe(40)
    expect((await shareFor(slow.address, 4)).body.accepted).toBe(4)
    const table = (await json(app, 'GET', '/api/difficulty')).body
    expect(table.activeMiners).toBe(2)
    const [f, s] = table.miners
    expect(f.address).toBe(fast.address)
    expect(Math.round(f.work / s.work)).toBe(10)

    // A block mined at the slow miner's own (easy) ticket is valid.
    const tpl = blockFromJSON((await json(app, 'GET', `/api/template?proposer=${slow.address}`)).body.block)
    expect(tpl.header.proof.length).toBe(96)
    const res = await mineVia(app, slow.address)
    expect(res.body.status).toBe('added')
  }, 30_000)
})

describe('proof of stake on the node', () => {
  it('runs slots, bundles attestations, and slashes a double-signer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      let clock = Date.now()
      const tick = (ms: number) => vi.setSystemTime((clock += ms))
      const { app, node } = await setup()
      const alice = generateKeyPair()
      node.faucetSend(alice.address, 100n * UNIT)
      await mineVia(app, alice.address)
      const st = node.chain.tip.state
      node.submitTx(signTx({ chainId: st.genesis.chainId, nonce: 0, fee: UNIT / 10n, body: { type: TxType.Stake, amount: 50n * UNIT } }, alice.privateKey, alice.publicKey))
      node.proposeConsensus(ConsensusMode.PoS, 3)
      while (node.chain.tip.state.mode !== ConsensusMode.PoS || node.chain.tip.block.header.mode !== ConsensusMode.PoS) {
        if (expectedModeNext(node) === ConsensusMode.PoS) break
        tick(1000)
        await mineVia(app, alice.address)
      }
      expect(expectedModeNext(node)).toBe(ConsensusMode.PoS)

      const propose = async (offset = 0) => {
        const tpl = blockFromJSON((await json(app, 'GET', `/api/template?proposer=${alice.address}`)).body.block)
        tpl.header.timestamp += offset
        tpl.header = sealPosHeader(tpl.header, alice.privateKey, alice.publicKey)
        return { tpl, res: await json(app, 'POST', '/api/block', blockToJSON(tpl)) }
      }

      // Too early: the slot hasn't opened yet.
      expect((await propose()).res.status).toBe(400)
      tick(15_000)
      const pos = (await json(app, 'GET', '/api/pos')).body
      expect(pos.leader).toBe(alice.address) // the only staker
      expect((await propose()).res.body.status).toBe('added')

      // Attest to the new tip; the next template carries it.
      const tip = node.chain.tip.hash
      const att = signAttestation(node.chain.genesis.chainId, hexToBytes(tip), alice.privateKey, alice.publicKey)
      expect((await json(app, 'POST', '/api/attest', { blockHash: tip, publicKey: bytesToHex(att.publicKey), signature: bytesToHex(att.signature) })).body.attestations).toBe(1)
      tick(15_000)
      const first = await propose()
      expect(decodePosProof(first.tpl.header.proof).attestations.length).toBe(1)

      // Double-sign at the same height: the node files slashing evidence by itself.
      // (Rewind the tip by proposing a sibling of `first` on the same parent.)
      const sibling = { ...first.tpl, header: sealPosHeader({ ...first.tpl.header, timestamp: first.tpl.header.timestamp + 1 }, alice.privateKey, alice.publicKey) }
      expect((await json(app, 'POST', '/api/block', blockToJSON(sibling))).body.status).toBe('added')
      const slashTx = node.mempool.list().find((e) => e.tx.body.type === TxType.Slash)
      expect(slashTx).toBeDefined()
      const stakeBefore = node.chain.tip.state.accounts.get(alice.address)!.stake
      tick(15_000)
      await propose()
      expect(node.chain.tip.state.accounts.get(alice.address)!.stake).toBe(stakeBefore / 2n)
    } finally {
      vi.useRealTimers()
    }
  })
})

function expectedModeNext(node: IsfcrNode) {
  const s = node.chain.tip.state
  return expectedMode(s, s.height + 1)
}

describe('VRF lottery on the node', () => {
  it('ranks tickets and accepts the winner, then a lower ticket wins a same-height race', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      let clock = Date.now()
      const tick = (ms: number) => vi.setSystemTime((clock += ms))
      const { app, node } = await setup()
      const players = [generateKeyPair(), generateKeyPair(), generateKeyPair()]
      for (const p of players) node.faucetSend(p.address, 10n * UNIT)
      node.proposeConsensus(ConsensusMode.VRFLottery, 3)
      while (expectedModeNext(node) !== ConsensusMode.VRFLottery) {
        tick(1000)
        await mineVia(app, generateKeyPair().address)
      }
      const st = node.chain.tip.state
      const entries = players.map((p) => {
        const ticket = drawTicket(st.genesis.chainId, hexToBytes(node.chain.tip.hash), st.height + 1, p.privateKey)
        return { p, ticket }
      })
      for (const e of entries) {
        const r = await json(app, 'POST', '/api/lottery/enter', { publicKey: bytesToHex(e.p.publicKey), ticket: bytesToHex(e.ticket) })
        expect(r.status).toBe(200)
      }
      const status = (await json(app, 'GET', '/api/lottery')).body
      expect(status.entries).toBe(3)
      const winner = entries.find((e) => e.p.address === status.best.address)!
      const loser = entries.find((e) => e.p.address !== status.best.address)!

      tick(15_000)
      // Build both blocks on the same parent before either is sent.
      const build = async (e: typeof winner) => {
        const tpl = blockFromJSON((await json(app, 'GET', `/api/template?proposer=${e.p.address}`)).body.block)
        tpl.header = sealVrfHeader(tpl.header, e.ticket, e.p.privateKey, e.p.publicKey)
        return blockToJSON(tpl)
      }
      const [loserBlock, winnerBlock] = [await build(loser), await build(winner)]
      // The loser rushes in first, but the winner's lower ticket takes the tip.
      expect((await json(app, 'POST', '/api/block', loserBlock)).body.status).toBe('added')
      expect((await json(app, 'POST', '/api/block', winnerBlock)).body.status).toBe('added')
      expect(node.chain.tip.block.header.proposer).toBe(winner.p.address)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('lottery after a restart', () => {
  it('bots enter even when no new tip arrives (no deadlock)', async () => {
    const { node } = await setup({ TXGEN: '1', TXGEN_INTERVAL_MS: '100000' })
    const app = await buildApi(node)
    cleanups.push(() => app.close())
    // Fund bots and switch to the lottery.
    node.txgen.tick()
    await mineVia(app, generateKeyPair().address)
    node.proposeConsensus(ConsensusMode.VRFLottery, 3)
    while (expectedModeNext(node) !== ConsensusMode.VRFLottery) await mineVia(app, generateKeyPair().address)
    // Simulate a restart: forget every ticket, then let a tick run without any new block.
    node.lottery.clear()
    expect(node.lottery.status().entries).toBe(0)
    ;(node.lottery as any).tick()
    expect(node.lottery.status().entries).toBeGreaterThan(0)
  })
})

describe('restarts', () => {
  it('keeps pending txs across a restart, and re-sends a faucet payout that was lost', async () => {
    const dir = await import('node:fs').then((fs) => fs.mkdtempSync('/tmp/isfcr-test-'))
    const env = { DB_PATH: `${dir}/node.sqlite`, TXGEN: '0', INITIAL_WORK: '16', OPEN_JOIN: '1' }
    const me = generateKeyPair()
    let node = new IsfcrNode(loadConfig(env).config)
    node.start()
    const token = node.join('restart-test')
    const first = node.claimFaucet(token, me.address)
    node.close()

    node = new IsfcrNode(loadConfig(env).config)
    node.start()
    expect(node.mempool.has(first)).toBe(true) // survived the restart
    expect(() => node.claimFaucet(token, me.address)).toThrow(/already claimed/)

    // Now simulate a payout that was truly lost (pool wiped): the claim may be retried.
    node.mempool.clear()
    const again = node.claimFaucet(token, me.address)
    expect(node.mempool.has(again)).toBe(true)
    node.close()
  })
})

describe('hard-fork demo', () => {
  it('an old-rules node splits off at the switch, and rejoins once it runs the new rules', async () => {
    const A = await setup()
    await A.app.listen({ port: 0, host: '127.0.0.1' })
    const urlA = `http://127.0.0.1:${(A.app.server.address() as any).port}`
    const miner = generateKeyPair()
    await mineVia(A.app, miner.address)

    // Node B: follows A, but ignores consensus switches. File-backed so it can be restarted.
    const dir = (await import('node:fs')).mkdtempSync('/tmp/isfcr-fork-')
    const envB = { DB_PATH: `${dir}/b.sqlite`, TXGEN: '0', INITIAL_WORK: '16', OPEN_JOIN: '1', FOLLOW_PEER: '1', OLD_RULES: '1' }
    let B = new IsfcrNode(loadConfig(envB).config)
    B.start()
    let appB = await buildApi(B)
    let peer = new Peer(B, urlA)
    peer.connect()
    await waitFor(() => B.chain.tip.hash === A.node.chain.tip.hash)

    // A switches to Dynamic PoW. Blocks before the switch reach B; the first new-rules block doesn't.
    A.node.proposeConsensus(ConsensusMode.DynamicPoW, 3)
    while (expectedModeNext(A.node) !== ConsensusMode.DynamicPoW) await mineVia(A.app, miner.address)
    await waitFor(() => B.chain.height === A.node.chain.height)
    const switchHeight = A.node.chain.height + 1
    await mineVia(A.app, miner.address) // first Dynamic PoW block on A
    await new Promise((r) => setTimeout(r, 300))
    expect(B.chain.height).toBe(switchHeight - 1) // B refused it

    // B's miners keep going under the old rules: the chains have split.
    expect(expectedMode(B.chain.tip.state, B.chain.height + 1, { ignoreGovernance: true })).toBe(ConsensusMode.GlobalPoW)
    expect((await mineVia(appB, generateKeyPair().address)).body.status).toBe('added')
    expect(B.chain.height).toBe(switchHeight)
    expect(B.chain.tip.hash).not.toBe(A.node.chain.tip.hash)
    await mineVia(A.app, miner.address) // A pulls ahead

    // Rejoin: restart B on the new rules. Its old-rules block is invalid now, so it adopts A's chain.
    peer.close()
    await appB.close()
    B.close()
    B = new IsfcrNode(loadConfig({ ...envB, OLD_RULES: '0' }).config)
    B.start()
    appB = await buildApi(B)
    peer = new Peer(B, urlA)
    peer.connect()
    await waitFor(() => B.chain.tip.hash === A.node.chain.tip.hash)
    expect(B.chain.atHeight(switchHeight)!.block.header.mode).toBe(ConsensusMode.DynamicPoW)
    peer.close()
    await appB.close()
    B.close()
  }, 30_000)
})

describe('host-run games', () => {
  async function gameSetup(mode: ConsensusMode, txgen = '0') {
    vi.useFakeTimers({ toFake: ['Date'] })
    let clock = Date.now()
    const tick = (ms: number) => vi.setSystemTime((clock += ms))
    const ctx = await setup({ TXGEN: txgen, TXGEN_INTERVAL_MS: '100000' })
    const players = [generateKeyPair(), generateKeyPair(), generateKeyPair()]
    for (const p of players) ctx.node.faucetSend(p.address, 10n * UNIT)
    ctx.node.proposeConsensus(mode, 3)
    while (expectedModeNext(ctx.node) !== mode) { tick(1000); await mineVia(ctx.app, generateKeyPair().address) }
    const act = async (k: typeof players[0], action: string, body: Record<string, unknown> = {}) => {
      const r = ctx.node.rounds.status() as any
      const sig = sign(actionBytes(ctx.node.chain.genesis.chainId, r.height, action, body), k.privateKey)
      return json(ctx.app, 'POST', '/api/round/act', { action, body, publicKey: bytesToHex(k.publicKey), signature: bytesToHex(sig) })
    }
    // The winner fetches its certificate and proposes.
    const proposeAs = async (k: typeof players[0]) => {
      const st = (await json(ctx.app, 'GET', `/api/round?who=${k.address}`)).body
      if (!st.cert) return null
      const tpl = blockFromJSON((await json(ctx.app, 'GET', `/api/template?proposer=${k.address}`)).body.block)
      tpl.header = sealHostBlock(tpl.header, hexToBytes(st.cert), k.privateKey, k.publicKey)
      return json(ctx.app, 'POST', '/api/block', blockToJSON(tpl))
    }
    return { ...ctx, players, act, tick, proposeAs, runTicks: () => (ctx.node.rounds as any).tick() }
  }
  const done = () => vi.useRealTimers()

  it('Proof of Presence: only people with the projector code get in, and one of them wins', async () => {
    try {
      const g = await gameSetup(ConsensusMode.PoP)
      const code = (await json(g.app, 'GET', '/api/admin/presence', undefined, { authorization: 'Bearer dev-admin' })).body.code
      expect((await g.act(g.players[0], 'present', { code: 'WRONG1' })).status).toBe(400)
      expect((await g.act(g.players[0], 'present', { code })).body.checkedIn).toBe(true)
      expect((await g.act(g.players[1], 'present', { code })).body.present).toBe(2)
      g.tick(26_000)
      g.runTicks()
      const winner = (g.node.rounds.status() as any).winner
      expect([g.players[0].address, g.players[1].address]).toContain(winner)
      const k = g.players.find((p) => p.address === winner)!
      expect((await g.proposeAs(k))!.body.status).toBe('added')
    } finally { done() }
  })

  it('Proof of Knowledge: the earliest correct locked-in answer wins; a wrong one never does', async () => {
    try {
      const g = await gameSetup(ConsensusMode.PoK)
      const st = (await json(g.app, 'GET', '/api/round')).body
      // The host's commitment is published before anyone answers.
      expect(st.commitment).toMatch(/^[0-9a-f]{64}$/)
      const right = (g.node.rounds as any).games.get(ConsensusMode.PoK).q.answer
      const wrong = (right + 1) % st.choices.length
      const commit = (k: typeof g.players[0], choice: number) => bytesToHex(sha256(new Writer().str('pok').str(String(choice)).str(k.address).str('salt').bytes()))
      await g.act(g.players[0], 'commit', { commit: commit(g.players[0], wrong) }) // first, but wrong
      g.tick(500)
      await g.act(g.players[1], 'commit', { commit: commit(g.players[1], right) })
      g.tick(500)
      await g.act(g.players[2], 'commit', { commit: commit(g.players[2], right) })
      g.tick(26_000)
      for (const [k, c] of [[g.players[0], wrong], [g.players[1], right], [g.players[2], right]] as const) {
        await g.act(k, 'reveal', { choice: c, salt: 'salt' })
      }
      const revealed = (await json(g.app, 'GET', '/api/round')).body
      expect(revealed.answer).toBe(right) // the host reveals, so the commitment can be checked
      g.tick(6_000)
      g.runTicks()
      expect((g.node.rounds.status() as any).winner).toBe(g.players[1].address)
      expect((await g.proposeAs(g.players[1]))!.body.status).toBe('added')
    } finally { done() }
  })

  it('Quiz-to-Vote: correct answers earn votes and the most-voted candidate wins', async () => {
    try {
      const g = await gameSetup(ConsensusMode.QtV)
      const right = (g.node.rounds as any).games.get(ConsensusMode.QtV).q.answer
      await g.act(g.players[0], 'stand')
      await g.act(g.players[1], 'ballot', { choice: right, vote: g.players[0].address })
      await g.act(g.players[2], 'ballot', { choice: (right + 1) % 4, vote: g.players[2].address }).catch(() => null) // not a candidate
      g.tick(26_000)
      g.runTicks()
      expect((g.node.rounds.status() as any).winner).toBe(g.players[0].address)
    } finally { done() }
  })

  it('Peer Vouching: vouches weighted by on-chain trust pick the winner', async () => {
    try {
      const g = await gameSetup(ConsensusMode.PoV)
      await g.act(g.players[0], 'stand')
      await g.act(g.players[1], 'stand')
      expect((await g.act(g.players[0], 'vouch', { for: g.players[0].address })).status).toBe(400) // not yourself
      await g.act(g.players[2], 'vouch', { for: g.players[1].address })
      g.tick(26_000)
      g.runTicks()
      expect((g.node.rounds.status() as any).winner).toBe(g.players[1].address)
    } finally { done() }
  })

  it('Simulated PoET: the shortest timer wins, and only after it has run out', async () => {
    try {
      const g = await gameSetup(ConsensusMode.PoET)
      for (const k of g.players) await g.act(k, 'join')
      const st = (await json(g.app, 'GET', '/api/round')).body
      g.tick(16_000 + st.shortest.waitMs)
      g.runTicks()
      expect((g.node.rounds.status() as any).winner).toBe(st.shortest.address)
    } finally { done() }
  })

  it('nobody plays: the host makes an empty block so the chain keeps moving', async () => {
    try {
      const g = await gameSetup(ConsensusMode.PoP)
      const before = g.node.chain.height
      g.tick(26_000 + 26_000)
      g.runTicks()
      expect(g.node.chain.height).toBe(before + 1)
      expect(g.node.chain.tip.block.header.proposer).toBe(g.node.config.instructor.address)
    } finally { done() }
  })
})

describe('activity', () => {
  it('lists what touched an address, newest first, and logs class events', async () => {
    const { app, node } = await setup()
    const a = generateKeyPair()
    const b = generateKeyPair()
    node.faucetSend(a.address, 10n * UNIT)
    await mineVia(app, a.address)
    node.submitTx(signTx({ chainId: node.chain.genesis.chainId, nonce: 0, fee: UNIT / 10n, body: { type: TxType.Transfer, to: b.address, amount: 2n * UNIT } }, a.privateKey, a.publicKey))
    const hist = (await json(app, 'GET', `/api/history/${a.address}`)).body
    expect(hist.map((h: any) => h.kind)).toEqual(['sent', 'mined', 'faucet'])
    expect(hist[0].height).toBeNull() // still pending
    const forB = (await json(app, 'GET', `/api/history/${b.address}`)).body
    expect(forB[0]).toMatchObject({ kind: 'received', counterparty: a.address, amount: String(2n * UNIT) })
    const events = (await json(app, 'GET', '/api/events')).body
    expect(events[0]).toMatchObject({ kind: 'block', height: 1 })
  })
})
