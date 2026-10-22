/**
 * Headless miner node for testing, demos and load tests:
 *   npm run miner -w @isfcr/node -- --url http://localhost:8080 [--name alice] [--stake 50]
 *     [--seed hex] [--count 3] [--no-shares 1] [--sleep ms]
 *
 * --name   joins the session under that name and claims the faucet (100 ISFCR), like a student.
 *          The key is saved to data/miners/<name>.key so the same name is the same identity.
 * --stake  after the faucet coins arrive, stakes that many ISFCR (for Proof of Stake).
 *
 * It follows whatever consensus mode the class is in:
 *   Global / Dynamic PoW  mines templates, restarting when the tip moves. In Dynamic PoW it
 *                         reports shares; --no-shares 1 demos sandbagging.
 *   Proof of Stake        signs a block when the stake lottery picks it.
 *   VRF Lottery           enters one ticket per block and proposes when it holds the lowest.
 * --sleep pauses after every 20k hashes to imitate a slow device (e.g. a phone).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  type KeyPair, ConsensusMode, SHARE_TARGET, TxType, UNIT, blockFromJSON, blockToJSON, bytesToHex, drawTicket,
  generateKeyPair, hexToBytes, keyPairFromPrivate, mineWithShares, parseISFCR, sealPosHeader, sealVrfHeader, signTx,
  txToJSON,
} from '@isfcr/core'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const url = (args.get('url') ?? 'http://localhost:8080').replace(/\/$/, '')
const name = args.get('name')
const stakeAmount = args.get('stake') ? parseISFCR(args.get('stake')!) : 0n
const count = Number(args.get('count') ?? Infinity)
const sendShares = !args.get('no-shares')
const sleepMs = Number(args.get('sleep') ?? 0)
const CHUNK = 20_000

const get = async (p: string) => (await fetch(url + p)).json()
const post = async (p: string, body: unknown) =>
  (await fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** --seed wins; otherwise a named miner keeps its key on disk; otherwise a throwaway key. */
function loadKey(): KeyPair {
  if (args.get('seed')) return keyPairFromPrivate(hexToBytes(args.get('seed')!))
  if (!name) return generateKeyPair()
  const dir = 'data/miners'
  const file = `${dir}/${name.replace(/[^\w-]/g, '_')}.key`
  if (existsSync(file)) return keyPairFromPrivate(hexToBytes(readFileSync(file, 'utf8').trim()))
  mkdirSync(dir, { recursive: true })
  const k = generateKeyPair()
  writeFileSync(file, bytesToHex(k.privateKey) + '\n', { mode: 0o600 })
  return k
}

const key = loadKey()

/** Join under --name and claim the faucet; an already-claimed faucet is fine. */
async function claimFaucet(): Promise<void> {
  if (!name) return
  const { token, error } = await post('/api/join', { code: name, name })
  if (!token) return void console.log(`join failed: ${error}`)
  const r = await post('/api/faucet', { token, address: key.address })
  console.log(r.error ? `faucet: ${r.error}` : `faucet: ${r.amount} ISFCR on the way (arrives with the next block)`)
}

/** Once the faucet coins have landed, stake --stake ISFCR (only if not already staked). */
let staked = false
async function maybeStake(): Promise<void> {
  if (staked || stakeAmount === 0n) return
  const acct = await get(`/api/state/${key.address}`)
  if (BigInt(acct.stake) > 0n) return void (staked = true)
  if (BigInt(acct.balance) < stakeAmount + UNIT / 10n) return
  const info = await get('/api/info')
  const tx = signTx({ chainId: info.chainId, nonce: acct.nextNonce, fee: UNIT / 10n, body: { type: TxType.Stake, amount: stakeAmount } }, key.privateKey, key.publicKey)
  const r = await post('/api/tx', txToJSON(tx))
  if (!r.error) {
    staked = true
    console.log(`staking ${args.get('stake')} ISFCR`)
  }
}

let found = 0
const log = (height: number, res: any, extra = '') => {
  console.log(`height ${height}: ${res.status ?? res.error}${extra}`)
  if (res.status === 'added') found++
}

/** One PoW block attempt on the current tip. */
async function mineOnce(): Promise<void> {
  const { block: tplJson } = await get(`/api/template?proposer=${key.address}`)
  const block = blockFromJSON(tplJson)
  const dynamic = block.header.mode === ConsensusMode.DynamicPoW
  const startTip = bytesToHex(block.header.prevHash)
  let nonce = BigInt(Math.floor(Math.random() * 2 ** 40))
  const started = Date.now()
  let tries = 0
  for (;;) {
    const r = mineWithShares(block.header, nonce, CHUNK, dynamic ? SHARE_TARGET : 0n)
    tries += r.tries
    if (dynamic && sendShares && r.shares.length) {
      await post('/api/shares', { header: tplJson.header, nonces: r.shares.map(String) }).catch(() => {})
    }
    if (r.found) {
      block.header.nonce = r.found.nonce
      const rate = Math.round(tries / ((Date.now() - started) / 1000))
      return log(block.header.height, await post('/api/block', blockToJSON(block)), ` (${rate} H/s)`)
    }
    nonce += BigInt(CHUNK)
    if (sleepMs) await sleep(sleepMs)
    const info = await get('/api/info')
    if (info.tip !== startTip) return // someone else won; restart on the new tip
    if (dynamic && Date.now() - started > 20_000) return // fresh difficulty ticket
  }
}

/** Proof of Stake: propose if the stake lottery picked us for the current round. */
const posDone = new Set<string>()
async function stakeOnce(): Promise<void> {
  const s = await get('/api/pos')
  const slot = `${s.height}:${s.round}`
  if (s.leader === key.address && Date.now() >= s.opensAt && !posDone.has(slot)) {
    posDone.add(slot)
    const block = blockFromJSON((await get(`/api/template?proposer=${key.address}`)).block)
    block.header = sealPosHeader(block.header, key.privateKey, key.publicKey)
    log(block.header.height, await post('/api/block', blockToJSON(block)), ' (proposed by stake)')
  }
  await sleep(1500)
}

/** VRF Lottery: one ticket per block; propose when ours is the lowest once the slot opens. */
let ticketFor = ''
let myTicket: Uint8Array | null = null
const lotteryDone = new Set<string>()
async function lotteryOnce(): Promise<void> {
  const info = await get('/api/info')
  if (ticketFor !== info.tip) {
    ticketFor = info.tip
    myTicket = drawTicket(info.chainId, hexToBytes(info.tip), info.height + 1, key.privateKey)
    const r = await post('/api/lottery/enter', { publicKey: bytesToHex(key.publicKey), ticket: bytesToHex(myTicket) })
    if (r.error) console.log(`lottery: ${r.error}`)
  }
  const s = await get('/api/lottery')
  if (myTicket && s.best?.address === key.address && Date.now() >= s.opensAt && !lotteryDone.has(info.tip)) {
    lotteryDone.add(info.tip)
    const block = blockFromJSON((await get(`/api/template?proposer=${key.address}`)).block)
    block.header = sealVrfHeader(block.header, myTicket, key.privateKey, key.publicKey)
    log(block.header.height, await post('/api/block', blockToJSON(block)), ' (lowest ticket)')
  }
  await sleep(1500)
}

console.log(`miner node ${name ?? ''} ${key.address} → ${url}${sendShares ? '' : ' (not reporting shares)'}`)
await claimFaucet()
while (found < count) {
  try {
    await maybeStake()
    const { nextMode: mode } = await get('/api/info') // the rules for the block we'd make next
    if (mode === ConsensusMode.GlobalPoW || mode === ConsensusMode.DynamicPoW) await mineOnce()
    else if (mode === ConsensusMode.PoS) await stakeOnce()
    else if (mode === ConsensusMode.VRFLottery) await lotteryOnce()
    else await sleep(2000)
  } catch (e) {
    console.log(`node unreachable (${(e as Error).message}); retrying`)
    await sleep(3000)
  }
}
