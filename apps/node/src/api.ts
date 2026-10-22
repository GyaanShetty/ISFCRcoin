import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import {
  type GenesisConfig, type SignedTx, ConsensusMode, PARAMS, SHARE_TARGET, SHARE_WORK, ValidationError,
  circulatingSupply, expectedMode, votingWeight, blockFromJSON, blockReward,
  blockToJSON, bytesToHex, difficulty, formatISFCR, hexToBytes, implementedModes, isValidAddress, txFromJSON, txToJSON,
} from '@isfcr/core'
import type { ChainNode } from './chain'
import type { IsfcrNode } from './node'
import type { Peer } from './gossip'
import { genesisToJSON } from './store'

type WS = { send(data: string): void; readyState: number; on(ev: string, fn: () => void): void }

function blockSummary(n: ChainNode) {
  const h = n.block.header
  const cb = n.block.txs[0] as { amount: bigint } | undefined // genesis has no coinbase
  return {
    hash: n.hash,
    height: h.height,
    prevHash: bytesToHex(h.prevHash),
    timestamp: h.timestamp,
    mode: h.mode,
    proposer: h.proposer,
    txCount: n.block.txs.length - 1,
    coinbase: (cb?.amount ?? 0n).toString(),
    work: n.state.totalWork.toString(),
  }
}

export async function buildApi(node: IsfcrNode, peers: Peer[] = []): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1 << 20 })
  await app.register(cors, { origin: true })
  await app.register(websocket)

  // ---- live feed ----
  const clients = new Set<WS>()
  const broadcast = (msg: unknown) => {
    const data = JSON.stringify(msg)
    for (const c of clients) if (c.readyState === 1) c.send(data)
  }
  const info = () => {
    const s = node.chain.tip.state
    return {
      chainId: s.genesis.chainId,
      genesisHash: node.chain.genesisHash,
      height: s.height,
      tip: node.chain.tip.hash,
      mode: s.mode,
      modeName: ConsensusMode[s.mode],
      // The rules the *next* block must follow; differs from `mode` right at a switch.
      nextMode: expectedMode(s, s.height + 1, { ignoreGovernance: node.config.oldRules }),
      target: s.target.toString(16),
      difficulty: difficulty(s.target),
      nextReward: blockReward(s.height + 1).toString(),
      emitted: s.emitted.toString(),
      scheduledSwitch: s.scheduledSwitch,
      mempoolSize: node.mempool.size,
      implementedModes: implementedModes(),
      oldRules: node.config.oldRules,
      openJoin: node.config.openJoin,
      txgen: node.txgen.running,
      peers: peers.map((p) => ({ url: p.baseUrl, connected: p.connected })),
      clients: clients.size,
      params: {
        targetBlockMs: PARAMS.TARGET_BLOCK_MS,
        maxTxsPerBlock: PARAMS.MAX_TXS_PER_BLOCK,
        minFee: PARAMS.MIN_FEE.toString(),
        halvingInterval: PARAMS.HALVING_INTERVAL,
        faucetAmount: PARAMS.FAUCET_AMOUNT.toString(),
        shareTarget: SHARE_TARGET.toString(16),
        shareWork: Number(SHARE_WORK),
      },
    }
  }

  node.on('block', (n: ChainNode) => broadcast({ type: 'block', block: blockToJSON(n.block), main: node.chain.isMain(n.hash) }))
  node.on('tip', ({ tip, reorgDepth }: { tip: ChainNode; reorgDepth: number }) =>
    broadcast({ type: 'tip', height: tip.state.height, hash: tip.hash, reorgDepth, info: info() }))
  node.on('tx', (tx: SignedTx, id: string) => broadcast({ type: 'tx', id, tx: txToJSON(tx) }))
  node.on('reset', (g: GenesisConfig) => broadcast({ type: 'reset', chainId: g.chainId }))
  node.on('slash', (e: { height: number; proposer: string }) => broadcast({ type: 'slash', ...e }))

  app.get('/ws', { websocket: true }, (socket: WS) => {
    clients.add(socket)
    socket.send(JSON.stringify({ type: 'hello', info: info() }))
    socket.on('close', () => clients.delete(socket))
  })

  // ---- errors ----
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError || (err as any).name === 'ValidationError') {
      return reply.code(400).send({ error: err.message })
    }
    if ((err as any).statusCode) return reply.code((err as any).statusCode).send({ error: err.message })
    console.error(err)
    return reply.code(500).send({ error: 'internal error' })
  })

  const bad = (msg: string) => new ValidationError(msg)
  const requireAddress = (a: unknown) => {
    if (typeof a !== 'string' || !isValidAddress(a)) throw bad('invalid address')
    return a
  }

  // ---- public read API ----
  app.get('/api/info', async () => info())
  app.get('/api/genesis', async () => genesisToJSON(node.chain.genesis))

  app.get('/api/chain', async (req: FastifyRequest<{ Querystring: { from?: string; limit?: string } }>) => {
    const limit = Math.min(200, Number(req.query.limit ?? 50))
    const to = node.chain.height
    const from = req.query.from !== undefined ? Number(req.query.from) : Math.max(0, to - limit + 1)
    return node.chain.range(from, Math.min(to, from + limit - 1)).map(blockSummary)
  })

  /** Every known block including side branches, for the fork-tree view. */
  app.get('/api/tree', async (req: FastifyRequest<{ Querystring: { since?: string } }>) => {
    const since = Number(req.query.since ?? Math.max(0, node.chain.height - 50))
    return node.chain.allNodes()
      .filter((n) => n.state.height >= since)
      .map((n) => ({ ...blockSummary(n), main: node.chain.isMain(n.hash) }))
      .sort((a, b) => a.height - b.height)
  })

  app.get('/api/block/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const id = req.params.id
    const n = /^\d+$/.test(id) ? node.chain.atHeight(Number(id)) : node.chain.get(id)
    if (!n) return reply.code(404).send({ error: 'block not found' })
    return { ...blockToJSON(n.block), main: node.chain.isMain(n.hash) }
  })

  app.get('/api/state/:addr', async (req: FastifyRequest<{ Params: { addr: string } }>) =>
    node.balanceOf(requireAddress(req.params.addr)))

  app.get('/api/mempool', async (req: FastifyRequest<{ Querystring: { limit?: string } }>) => {
    const entries = node.mempool.list(Math.min(1000, Number(req.query.limit ?? 200)))
    return { size: node.mempool.size, txs: entries.map((e) => ({ id: e.id, sender: e.sender, receivedAt: e.receivedAt, tx: txToJSON(e.tx) })) }
  })

  app.get('/api/leaderboard', async () => node.leaderboard())
  app.get('/api/sessions', async () => node.store.listSessions())

  /** Block template for miners. `txs` (comma-separated ids) restricts selection to the miner's picks. */
  app.get('/api/template', async (req: FastifyRequest<{ Querystring: { proposer?: string; txs?: string } }>) => {
    const proposer = requireAddress(req.query.proposer)
    const ids = req.query.txs ? req.query.txs.split(',').filter(Boolean) : undefined
    const t = node.template(proposer, ids)
    return { block: blockToJSON(t.block), reward: t.reward.toString(), fees: t.fees.toString() }
  })

  // ---- submissions ----
  app.post('/api/tx', async (req: FastifyRequest<{ Body: any }>) => {
    let tx
    try {
      tx = txFromJSON(req.body)
    } catch (e) {
      throw bad(`malformed tx: ${(e as Error).message}`)
    }
    if ((tx as any).type === 0) throw bad('coinbase txs cannot be submitted')
    return node.submitTx(tx as SignedTx)
  })

  app.post('/api/block', async (req: FastifyRequest<{ Body: any }>) => {
    let block
    try {
      block = blockFromJSON(req.body)
    } catch (e) {
      throw bad(`malformed block: ${(e as Error).message}`)
    }
    const r = node.submitBlock(block)
    return { ...r, tip: node.chain.tip.hash, height: node.chain.height }
  })

  /** Dynamic PoW: `header` is the template header the shares were mined on, `nonces` the share nonces. */
  app.post('/api/shares', async (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Record<string, any>
    let header
    let nonces: bigint[]
    try {
      header = blockFromJSON({ header: b.header, txs: [] }).header
      nonces = (b.nonces as unknown[]).map((n) => BigInt(String(n)))
    } catch (e) {
      throw bad(`malformed shares: ${(e as Error).message}`)
    }
    requireAddress(header.proposer)
    return node.submitShares(header, nonces)
  })

  /** Consensus-switch proposals with live tallies (weights are balance + stake, as on-chain). */
  app.get('/api/proposals', async () => {
    const st = node.chain.tip.state
    const total = circulatingSupply(st)
    return [...st.proposals.values()]
      .map((p) => ({
        id: p.id,
        proposer: p.proposer,
        byInstructor: p.proposer === st.genesis.instructorAddress,
        mode: p.mode,
        modeName: ConsensusMode[p.mode],
        activateAt: p.activateAt,
        passed: p.passed,
        open: !p.passed && st.height + 1 < p.activateAt,
        votesFor: [...p.votesFor],
        votesAgainst: [...p.votesAgainst],
        support: votingWeight(st, p.votesFor).toString(),
        against: votingWeight(st, p.votesAgainst).toString(),
        circulating: total.toString(),
      }))
      .sort((a, b) => b.activateAt - a.activateAt)
  })

  /** Host-run games (PoK, QtV, PoP, PoV, PoET): round status, personalised when `who` is given. */
  app.get('/api/round', async (req: FastifyRequest<{ Querystring: { who?: string } }>) =>
    node.rounds.status(req.query.who && isValidAddress(req.query.who) ? req.query.who : undefined))

  /** A signed player action: { action, body, publicKey, signature }. */
  app.post('/api/round/act', async (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Record<string, any>
    try {
      return node.rounds.act(String(b.action), hexToBytes(String(b.publicKey)), hexToBytes(String(b.signature)), (b.body ?? {}) as Record<string, any>)
    } catch (e) {
      throw bad((e as Error).message)
    }
  })

  app.get('/api/lottery', async () => node.lottery.status())

  app.post('/api/lottery/enter', async (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Record<string, any>
    try {
      return node.lottery.enter(hexToBytes(String(b.publicKey)), hexToBytes(String(b.ticket)))
    } catch (e) {
      throw bad((e as Error).message)
    }
  })

  app.get('/api/pos', async () => node.pos.status())

  app.post('/api/attest', async (req: FastifyRequest) => {
    const b = (req.body ?? {}) as Record<string, any>
    try {
      return { attestations: node.pos.attest(String(b.blockHash), hexToBytes(String(b.publicKey)), hexToBytes(String(b.signature))) }
    } catch (e) {
      throw bad((e as Error).message)
    }
  })

  app.get('/api/difficulty', async () => ({
    mode: node.chain.tip.state.mode,
    activeMiners: node.difficulty.activeMiners().length,
    scale: node.difficulty.scale,
    miners: node.difficulty.table(),
  }))

  app.post('/api/join', async (req: FastifyRequest<{ Body: { code?: string; name?: string } }>) =>
    ({ token: node.join(String(req.body?.code ?? ''), req.body?.name ? String(req.body.name) : undefined) }))
  app.get('/api/names', async () => ({
    ...Object.fromEntries(node.txgen.bots().map((b, i) => [b.address, `Bot ${i + 1}`])),
    ...node.store.names(),
  }))

  app.post('/api/faucet', async (req: FastifyRequest<{ Body: { token?: string; address?: string } }>) => {
    const txid = node.claimFaucet(String(req.body?.token ?? ''), requireAddress(req.body?.address))
    return { txid, amount: formatISFCR(PARAMS.FAUCET_AMOUNT) }
  })

  // ---- admin (instructor) ----
  const admin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.headers.authorization !== `Bearer ${node.config.adminToken}`) return reply.code(401).send({ error: 'admin token required' })
  }

  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, any>

  app.post('/api/admin/joincodes', { preHandler: admin }, async (req: FastifyRequest) =>
    ({ codes: node.createJoinCodes(Math.min(500, Number(body(req).count ?? 10))) }))
  app.get('/api/admin/joincodes', { preHandler: admin }, async () => node.store.listJoinCodes())

  app.post('/api/admin/consensus', { preHandler: admin }, async (req: FastifyRequest) =>
    ({ txid: node.proposeConsensus(Number(body(req).mode), Number(body(req).activateIn ?? 5)) }))

  app.post('/api/admin/txgen', { preHandler: admin }, async (req: FastifyRequest) => {
    body(req).on ? node.txgen.start() : node.txgen.stop()
    return { running: node.txgen.running }
  })

  app.post('/api/admin/reset', { preHandler: admin }, async () => ({ genesis: genesisToJSON(node.reset()) }))

  /** The rotating Proof of Presence code, for the projector only. */
  app.get('/api/admin/presence', { preHandler: admin }, async () => ({ code: node.rounds.presenceCode() }))

  /** Replace the quiz bank: [{ text, choices: [..], answer: index }]. Empty list restores the default. */
  app.post('/api/admin/questions', { preHandler: admin }, async (req: FastifyRequest) => {
    const qs = ((req.body ?? {}) as Record<string, any>).questions
    if (!Array.isArray(qs)) throw bad('questions must be a list')
    for (const q of qs) {
      if (typeof q.text !== 'string' || !Array.isArray(q.choices) || q.choices.length < 2 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
        throw bad('each question needs text, at least two choices and the index of the right one')
      }
    }
    node.rounds.setQuestions(qs)
    return { questions: qs.length }
  })

  /** Lets the admin page check a token before showing controls. */
  app.get('/api/admin/status', { preHandler: admin }, async () => ({
    txgen: node.txgen.running,
    openJoin: node.config.openJoin,
    joinCodes: node.store.listJoinCodes().length,
    sessions: node.store.listSessions().length,
  }))

  // ---- static web client ----
  const dist = node.config.webDist && resolve(node.config.webDist)
  if (dist && existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist })
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html'))
  }

  return app
}
