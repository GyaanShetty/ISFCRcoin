import { randomBytes } from 'node:crypto'
import {
  type Address, ConsensusMode, HOST_ATTESTED_MODES, TxType, ValidationError, Writer, actionBytes, addressFromPublicKey, bytesToBigInt,
  bytesToHex, expectedMode, hexToBytes, isRegistered, issueCert, roundOpensAt, sealHostBlock, sha256, utf8ToBytes, verify,
} from '@isfcr/core'
import type { ChainNode } from './chain'
import type { IsfcrNode } from './node'
import { type Question, QUESTIONS } from './questions'

/** Context for one slot (one block height) of a host-run game. */
export interface Round {
  height: number
  prevHash: string
  chainId: string
  startedAt: number
  opensAt: number
}

interface Decision { winner: Address; evidence: Uint8Array }

/** A consensus game played on the host. One instance per mode, reset every round. */
interface Game {
  mode: ConsensusMode
  /** Extra time after the slot opens before giving up and letting the host make an empty block. */
  graceMs: number
  /** Minimum time players get to act after a round starts, however old the parent block is. */
  answerMs: number
  start(r: Round): void
  act(r: Round, who: Address, action: string, body: Record<string, any>, signature: Uint8Array): unknown
  status(r: Round, who?: Address): Record<string, unknown>
  decide(r: Round, now: number): Decision | null
}

const h32 = (...parts: (string | Uint8Array)[]) => sha256(parts.reduce((w, p) => (typeof p === 'string' ? w.str(p) : w.varBytes(p)), new Writer()).bytes())
const lowest = <T>(xs: T[], key: (x: T) => bigint) => xs.reduce<T | null>((best, x) => (best === null || key(x) < key(best) ? x : best), null)


// ---------------------------------------------------------------- Simulated PoET

/** Everyone asks the host's timer for a random wait; the shortest wait wins once it has elapsed. */
class PoETGame implements Game {
  mode = ConsensusMode.PoET
  graceMs = 30_000
  answerMs = 0
  private waits = new Map<Address, number>()
  constructor(private secret: Uint8Array) {}
  start() { this.waits.clear() }
  draw(r: Round, who: Address): number {
    // Exponential wait (mean 15 s), deterministic per round and player, from the host's secret.
    const u = Number(bytesToBigInt(h32('poet', this.secret, r.prevHash, who)) % 1_000_000n + 1n) / 1_000_001
    return Math.round(-Math.log(u) * 15_000)
  }
  act(r: Round, who: Address, action: string) {
    if (action !== 'join') throw new ValidationError('unknown action')
    if (!this.waits.has(who)) this.waits.set(who, this.draw(r, who))
    return { waitMs: this.waits.get(who) }
  }
  status(r: Round, who?: Address) {
    const best = lowest([...this.waits], ([, w]) => BigInt(w))
    return {
      entrants: this.waits.size,
      myWaitMs: who ? this.waits.get(who) ?? null : null,
      shortest: best ? { address: best[0], waitMs: best[1], at: r.startedAt + best[1] } : null,
    }
  }
  decide(r: Round, now: number) {
    const best = lowest([...this.waits], ([, w]) => BigInt(w))
    if (!best || now < r.startedAt + best[1]) return null
    return { winner: best[0], evidence: h32('poet', JSON.stringify([...this.waits].sort())) }
  }
}

// ---------------------------------------------------------------- Proof of Presence

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROTATE_MS = 10_000

/** A code on the projector changes every 10 s. Only people who can see it can check in. */
class PresenceGame implements Game {
  mode = ConsensusMode.PoP
  graceMs = 25_000
  answerMs = 15_000
  private present = new Map<Address, Uint8Array>() // who → their signature (the lottery ticket)
  constructor(private secret: Uint8Array) {}
  start() { this.present.clear() }
  code(r: Round, at = Date.now()): string {
    const k = Math.floor(at / ROTATE_MS)
    const h = h32('pop', this.secret, r.prevHash, String(k))
    return Array.from(h.slice(0, 6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
  }
  act(r: Round, who: Address, action: string, body: Record<string, any>, signature: Uint8Array) {
    if (action !== 'present') throw new ValidationError('unknown action')
    const code = String(body.code ?? '').trim().toUpperCase()
    // Accept the current code and the previous one, so a code that just rotated still works.
    if (code !== this.code(r) && code !== this.code(r, Date.now() - ROTATE_MS)) throw new ValidationError('that code has expired, look at the screen again')
    this.present.set(who, signature)
    return { checkedIn: true, present: this.present.size }
  }
  status(_r: Round, who?: Address) {
    return { present: this.present.size, checkedIn: who ? this.present.has(who) : false, rotateMs: ROTATE_MS }
  }
  decide(r: Round, now: number) {
    if (now < r.opensAt || this.present.size === 0) return null
    // Among people in the room, the lowest hash of their signature wins (a verifiable draw).
    const best = lowest([...this.present], ([, sig]) => bytesToBigInt(sha256(sig)))!
    return { winner: best[0], evidence: h32('pop', String(this.present.size), bytesToHex(sha256(best[1]))) }
  }
}

// ---------------------------------------------------------------- Proof of Knowledge

/**
 * A question goes out with a commitment to its answer (hash of answer + secret salt),
 * so the host can't change the answer later. Players commit hash(choice | address | salt),
 * then reveal once the slot opens. Earliest correct commit wins.
 */
class KnowledgeGame implements Game {
  mode = ConsensusMode.PoK
  graceMs = 20_000
  answerMs = 20_000
  private q: Question = QUESTIONS[0]
  private salt = new Uint8Array(32)
  private commits = new Map<Address, { commit: string; at: number }>()
  private correct = new Map<Address, number>() // who → commit time
  constructor(private bank: () => Question[]) {}
  start(r: Round) {
    const bank = this.bank()
    this.q = bank[Number(bytesToBigInt(sha256(hexToBytes(r.prevHash))) % BigInt(bank.length))]
    this.salt = randomBytes(32)
    this.commits.clear()
    this.correct.clear()
  }
  commitment() { return bytesToHex(h32('pok-answer', String(this.q.answer), this.salt)) }
  act(r: Round, who: Address, action: string, body: Record<string, any>) {
    if (action === 'commit') {
      if (Date.now() >= r.opensAt) throw new ValidationError('answers closed for this block')
      if (this.commits.has(who)) throw new ValidationError('you already locked in an answer')
      this.commits.set(who, { commit: String(body.commit), at: Date.now() })
      return { locked: true }
    }
    if (action === 'reveal') {
      if (Date.now() < r.opensAt) throw new ValidationError('wait until answers close')
      const c = this.commits.get(who)
      if (!c) throw new ValidationError('no answer locked in')
      const expect = bytesToHex(h32('pok', String(body.choice), who, String(body.salt)))
      if (expect !== c.commit) throw new ValidationError('reveal does not match your locked answer')
      if (Number(body.choice) === this.q.answer) this.correct.set(who, c.at)
      return { correct: Number(body.choice) === this.q.answer }
    }
    throw new ValidationError('unknown action')
  }
  status(r: Round, who?: Address) {
    const open = Date.now() >= r.opensAt
    return {
      question: this.q.text,
      choices: this.q.choices,
      commitment: this.commitment(),
      locked: who ? this.commits.has(who) : false,
      answers: this.commits.size,
      // After answers close the host reveals, so anyone can check the commitment.
      answer: open ? this.q.answer : null,
      salt: open ? bytesToHex(this.salt) : null,
      correct: open ? this.correct.size : null,
    }
  }
  decide(r: Round, now: number) {
    if (now < r.opensAt + 5_000) return null // give players a few seconds to reveal
    const best = lowest([...this.correct], ([a, at]) => BigInt(at) * (1n << 64n) + (bytesToBigInt(sha256(utf8ToBytes(a))) >> 192n))
    if (!best) return null
    return { winner: best[0], evidence: h32('pok', this.q.text, this.commitment(), this.commits.get(best[0])!.commit) }
  }
}

// ---------------------------------------------------------------- Quiz-to-Vote

/** Anyone can stand as a candidate. Answering the quiz correctly earns one vote. Most votes wins. */
class QuizVoteGame implements Game {
  mode = ConsensusMode.QtV
  graceMs = 20_000
  answerMs = 25_000
  private q: Question = QUESTIONS[0]
  private candidates = new Set<Address>()
  private ballots = new Map<Address, { choice: number; vote: Address }>()
  constructor(private bank: () => Question[], private botCandidates: () => Address[]) {}
  start(r: Round) {
    const bank = this.bank()
    this.q = bank[Number((bytesToBigInt(sha256(hexToBytes(r.prevHash))) >> 8n) % BigInt(bank.length))]
    this.candidates = new Set(this.botCandidates().slice(0, 2))
    this.ballots.clear()
  }
  act(r: Round, who: Address, action: string, body: Record<string, any>) {
    if (Date.now() >= r.opensAt) throw new ValidationError('voting closed for this block')
    if (action === 'stand') {
      this.candidates.add(who)
      return { standing: true }
    }
    if (action === 'ballot') {
      const vote = String(body.vote)
      if (!this.candidates.has(vote)) throw new ValidationError('not a candidate')
      this.ballots.set(who, { choice: Number(body.choice), vote })
      return { cast: true }
    }
    throw new ValidationError('unknown action')
  }
  tally() {
    const t = new Map<Address, number>([...this.candidates].map((c) => [c, 0]))
    for (const b of this.ballots.values()) if (b.choice === this.q.answer) t.set(b.vote, (t.get(b.vote) ?? 0) + 1)
    return t
  }
  status(r: Round, who?: Address) {
    const open = Date.now() >= r.opensAt
    return {
      question: this.q.text,
      choices: this.q.choices,
      candidates: [...this.candidates],
      voted: who ? this.ballots.has(who) : false,
      standing: who ? this.candidates.has(who) : false,
      ballots: this.ballots.size,
      answer: open ? this.q.answer : null,
      tally: open ? Object.fromEntries(this.tally()) : null,
    }
  }
  decide(r: Round, now: number) {
    if (now < r.opensAt) return null
    const t = [...this.tally()].filter(([, v]) => v > 0)
    if (!t.length) return null
    const top = Math.max(...t.map(([, v]) => v))
    // Ties go to a draw seeded by the parent hash.
    const winner = lowest(t.filter(([, v]) => v === top), ([a]) => bytesToBigInt(h32('qtv', r.prevHash, a)))![0]
    return { winner, evidence: h32('qtv', this.q.text, JSON.stringify(t.sort())) }
  }
}

// ---------------------------------------------------------------- Proof of Peer Vouching

/**
 * Trust comes from the chain: how many different people you've exchanged coins with
 * (capped). Candidates stand; everyone vouches for one; vouches are weighted by trust.
 * Fake accounts paying each other inflate trust, which is the Sybil-ring lesson.
 */
class VouchGame implements Game {
  mode = ConsensusMode.PoV
  graceMs = 20_000
  answerMs = 20_000
  private candidates = new Set<Address>()
  private vouches = new Map<Address, Address>() // voucher → candidate
  private trustCache: { tip: string; trust: Map<Address, number> } | null = null
  constructor(private node: IsfcrNode, private botCandidates: () => Address[]) {}
  trust(): Map<Address, number> {
    const tip = this.node.chain.tip.hash
    if (this.trustCache?.tip === tip) return this.trustCache.trust
    const g = this.node.chain.genesis
    const peers = new Map<Address, Set<Address>>()
    const link = (a: Address, b: Address) => {
      if (a === b) return
      ;(peers.get(a) ?? peers.set(a, new Set()).get(a)!).add(b)
      ;(peers.get(b) ?? peers.set(b, new Set()).get(b)!).add(a)
    }
    for (const n of this.node.chain.range(1, this.node.chain.height)) {
      for (const tx of n.block.txs.slice(1) as any[]) {
        if (tx.body?.type !== TxType.Transfer) continue
        link(addressFromPublicKey(tx.publicKey), tx.body.to)
      }
    }
    const trust = new Map<Address, number>()
    for (const [a, set] of peers) {
      if (a === g.faucetAddress || a === g.instructorAddress) continue
      trust.set(a, Math.min(5, set.size)) // the faucet counts as one edge, so newcomers start at 1
    }
    this.trustCache = { tip, trust }
    return trust
  }
  start() {
    this.candidates = new Set(this.botCandidates().slice(0, 2))
    this.vouches.clear()
  }
  act(r: Round, who: Address, action: string, body: Record<string, any>) {
    if (Date.now() >= r.opensAt) throw new ValidationError('vouching closed for this block')
    if (action === 'stand') {
      this.candidates.add(who)
      return { standing: true }
    }
    if (action === 'vouch') {
      const target = String(body.for)
      if (!this.candidates.has(target)) throw new ValidationError('not a candidate')
      if (target === who) throw new ValidationError("you can't vouch for yourself")
      this.vouches.set(who, target)
      return { vouched: true, weight: this.trust().get(who) ?? 0 }
    }
    throw new ValidationError('unknown action')
  }
  weights() {
    const trust = this.trust()
    const w = new Map<Address, number>([...this.candidates].map((c) => [c, 0]))
    for (const [voucher, c] of this.vouches) w.set(c, (w.get(c) ?? 0) + (trust.get(voucher) ?? 0))
    return w
  }
  status(_r: Round, who?: Address) {
    const trust = this.trust()
    return {
      candidates: Object.fromEntries(this.weights()),
      myTrust: who ? trust.get(who) ?? 0 : 0,
      vouchedFor: who ? this.vouches.get(who) ?? null : null,
      standing: who ? this.candidates.has(who) : false,
      topTrust: [...trust].sort((a, b) => b[1] - a[1]).slice(0, 12),
    }
  }
  decide(r: Round, now: number) {
    if (now < r.opensAt) return null
    const w = [...this.weights()].filter(([, v]) => v > 0)
    if (!w.length) return null
    const top = Math.max(...w.map(([, v]) => v))
    const winner = lowest(w.filter(([, v]) => v === top), ([a]) => bytesToBigInt(h32('pov', r.prevHash, a)))![0]
    return { winner, evidence: h32('pov', JSON.stringify(w.sort())) }
  }
}

// ---------------------------------------------------------------- the service

const PROPOSE_WINDOW_MS = 8_000

/**
 * Runs the active host game each slot, signs the winner's certificate, and keeps the
 * chain alive: bots that win propose themselves, and if nobody qualifies (or the winner
 * doesn't show up) the host makes an empty block with its own key.
 */
export class RoundService {
  private secret = randomBytes(32)
  private games: Map<ConsensusMode, Game>
  private round: Round | null = null
  private decided: { winner: Address; cert: Uint8Array; at: number } | null = null
  private proposedFor = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private customQuestions: Question[] | null = null

  constructor(private node: IsfcrNode, private bots: () => { address: Address; privateKey: Uint8Array; publicKey: Uint8Array }[]) {
    const bank = () => this.customQuestions ?? QUESTIONS
    const botAddrs = () => this.bots().map((b) => b.address)
    this.games = new Map<ConsensusMode, Game>([
      [ConsensusMode.PoET, new PoETGame(this.secret)],
      [ConsensusMode.PoP, new PresenceGame(this.secret)],
      [ConsensusMode.PoK, new KnowledgeGame(bank)],
      [ConsensusMode.QtV, new QuizVoteGame(bank, botAddrs)],
      [ConsensusMode.PoV, new VouchGame(node, botAddrs)],
    ])
  }

  start(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 500)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  clear(): void {
    this.round = null
    this.decided = null
    this.proposedFor.clear()
  }

  setQuestions(qs: Question[] | null): void {
    this.customQuestions = qs?.length ? qs : null
  }

  private activeGame(): Game | null {
    const s = this.node.chain.tip.state
    const mode = expectedMode(s, s.height + 1, { ignoreGovernance: this.node.config.oldRules })
    return (HOST_ATTESTED_MODES as readonly ConsensusMode[]).includes(mode) ? this.games.get(mode)! : null
  }

  /** The round for the current tip, starting a fresh one when the tip (or mode) changed. */
  private current(): { game: Game; round: Round } | null {
    const game = this.activeGame()
    if (!game) return null
    const tip = this.node.chain.tip
    if (!this.round || this.round.prevHash !== tip.hash) {
      const s = tip.state
      this.round = {
        height: s.height + 1,
        prevHash: tip.hash,
        chainId: s.genesis.chainId,
        startedAt: Date.now(),
        opensAt: Math.max(roundOpensAt(s.recentTimestamps[s.recentTimestamps.length - 1], 0), Date.now() + game.answerMs),
      }
      this.decided = null
      game.start(this.round)
      if (game.mode === ConsensusMode.PoET) for (const b of this.bots()) game.act(this.round, b.address, 'join', {}, new Uint8Array())
    }
    return { game, round: this.round }
  }

  onTip(_tip: ChainNode): void {
    this.current()
  }

  /** Presence code for the projector (admin only: anyone with it can check in). */
  presenceCode(): string | null {
    const c = this.current()
    return c && c.game instanceof PresenceGame ? c.game.code(c.round) : null
  }

  status(who?: Address) {
    const c = this.current()
    if (!c) return { active: false }
    return {
      active: true,
      mode: c.game.mode,
      modeName: ConsensusMode[c.game.mode],
      height: c.round.height,
      opensAt: c.round.opensAt,
      startedAt: c.round.startedAt,
      winner: this.decided?.winner ?? null,
      cert: this.decided && who && this.decided.winner === who ? bytesToHex(this.decided.cert) : null,
      ...c.game.status(c.round, who),
    }
  }

  act(action: string, publicKey: Uint8Array, signature: Uint8Array, body: Record<string, any>) {
    const c = this.current()
    if (!c) throw new ValidationError('no game is running')
    const who = addressFromPublicKey(publicKey)
    if (!verify(signature, actionBytes(c.round.chainId, c.round.height, action, body), publicKey)) throw new ValidationError('bad signature')
    if (!isRegistered(this.node.chain.tip.state, who)) throw new ValidationError('only people holding coins can play')
    return c.game.act(c.round, who, action, body, signature)
  }

  private certify(round: Round, game: Game, winner: Address, evidence: Uint8Array): Uint8Array {
    const host = this.node.config.instructor
    return issueCert(round.chainId, round.height, hexToBytes(round.prevHash), winner, game.mode, evidence, host.privateKey, host.publicKey)
  }

  private propose(key: { address: Address; privateKey: Uint8Array; publicKey: Uint8Array }, cert: Uint8Array): void {
    const block = this.node.template(key.address).block
    block.header = sealHostBlock(block.header, cert, key.privateKey, key.publicKey)
    try {
      this.node.submitBlock(block)
    } catch (e) {
      console.warn(`[rounds] block rejected: ${(e as Error).message}`)
    }
  }

  private tick(now = Date.now()): void {
    const c = this.current()
    if (!c || now < c.round.opensAt) return
    const { game, round } = c
    if (!this.decided) {
      const d = game.decide(round, now)
      if (d) this.decided = { winner: d.winner, cert: this.certify(round, game, d.winner, d.evidence), at: now }
    }
    if (this.proposedFor.has(round.prevHash)) return
    const bot = this.decided && this.bots().find((b) => b.address === this.decided!.winner)
    if (bot) {
      this.proposedFor.add(round.prevHash)
      return this.propose(bot, this.decided!.cert)
    }
    // Nobody qualified in time, or the human winner didn't propose: the host makes an empty block.
    const stalled = this.decided ? now > this.decided.at + PROPOSE_WINDOW_MS : now > round.opensAt + game.graceMs
    if (stalled) {
      this.proposedFor.add(round.prevHash)
      const host = this.node.config.instructor
      this.propose(host, this.certify(round, game, host.address, h32('fallback', round.prevHash)))
    }
  }
}
