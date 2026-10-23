import { ConsensusMode, HOST_ATTESTED_MODES, formatISFCR } from '@isfcr/core'
import { api } from './api'
import { getLive, subscribeLive } from './live'
import { notify } from './notify'
import { progress } from './progress'
import { getWallet } from './wallet'

/**
 * Turns chain events into explanations: a celebration and a "here's why you won" note
 * when you make a block, a note when coins arrive, and the rule explanation when the
 * class switches modes.
 */
const WHY: Record<number, string> = {
  [ConsensusMode.GlobalPoW]: 'Your phone found a hash below the target before anyone else.',
  [ConsensusMode.DynamicPoW]: 'You hit your personal target first. It was scaled to your phone\'s speed.',
  [ConsensusMode.PoS]: 'The stake lottery picked you, and your phone signed the block.',
  [ConsensusMode.VRFLottery]: 'Your ticket had the lowest number of everyone\'s.',
  [ConsensusMode.PoK]: 'You were the fastest correct answer.',
  [ConsensusMode.QtV]: 'You got the most votes from people who answered correctly.',
  [ConsensusMode.PoP]: 'You checked in from the room and won the draw.',
  [ConsensusMode.PoV]: 'Classmates vouched for you, weighted by their trust.',
  [ConsensusMode.PoET]: 'Your timer ran out first.',
}

const coins = (units: string | bigint) => `${formatISFCR(BigInt(units))} ISFCR`

let lastBlockHash = ''
let lastCelebration = 0 // fast early blocks shouldn't fire the burst every second
// Wins close together are reported as one running total.
let burst = { count: 0, earned: 0n, last: 0 }
let lastNextMode: number | null = null
let seenTx: Set<string> | null = null
let lastTip = ''

subscribeLive(() => {
  const live = getLive()
  const key = getWallet().key
  const info = live.info

  // A new block: did we make it?
  const b = live.lastBlockJson
  if (b && b.hash !== lastBlockHash) {
    lastBlockHash = b.hash
    if (key && b.header.proposer === key.address) {
      const reward = b.txs[0]?.amount ?? '0'
      if (Date.now() - lastCelebration > 20_000) {
        lastCelebration = Date.now()
        notify.celebrate(b.header.height)
      }
      const now = Date.now()
      burst = now - burst.last < 15_000 ? { count: burst.count + 1, earned: burst.earned + BigInt(reward), last: now } : { count: 1, earned: BigInt(reward), last: now }
      notify.toast(burst.count === 1
        ? { group: 'win', tone: 'win', title: `You made block ${b.header.height}`, body: `${WHY[b.header.mode] ?? ''} You earned ${coins(reward)}, including fees.` }
        : { group: 'win', tone: 'win', title: `You made ${burst.count} blocks in a row`, body: `Latest is block ${b.header.height}. ${coins(burst.earned)} earned in this streak. Blocks come fast early on because difficulty starts low and climbs.` })
      progress.win(b.header.mode)
      progress.tried(b.header.mode)
    }
  }

  // The rules for the next block changed: explain them once.
  if (info && info.nextMode !== lastNextMode) {
    const first = lastNextMode === null
    lastNextMode = info.nextMode
    if (!first && !progress.get().introduced.includes(info.nextMode)) notify.openSheet(info.nextMode)
    if (!first) notify.toast({ tone: 'info', title: 'The rules just changed', body: `The class is now on ${ConsensusMode[info.nextMode]}. Tap the mode at the top any time to see how it works.` })
  }

  // Coins that arrived (faucet, transfers from classmates).
  if (key && info && info.tip !== lastTip) {
    lastTip = info.tip
    api.history(key.address).then((items) => {
      const ids = new Set(items.filter((i) => i.txid && i.height !== null).map((i) => i.txid!))
      if (seenTx) {
        for (const i of items) {
          if (!i.txid || i.height === null || seenTx.has(i.txid)) continue
          if (i.kind === 'received') notify.toast({ group: 'coins', tone: 'coins', title: `You received ${coins(i.amount)}`, body: 'A classmate sent you coins. It\'s in your balance now that the block is in.' })
          if (i.kind === 'faucet') notify.toast({ tone: 'coins', title: `Your ${coins(i.amount)} arrived`, body: 'The faucet\'s gift is in. It became real once a block included it.' })
        }
      }
      seenTx = ids
    }).catch(() => {})
  }

  // Taking part counts as having tried a mode (PoW counts once you actually mine).
  if (info && key && !(info.mode === ConsensusMode.GlobalPoW || info.mode === ConsensusMode.DynamicPoW)) {
    if (info.mode === ConsensusMode.PoS || info.mode === ConsensusMode.VRFLottery || (HOST_ATTESTED_MODES as readonly number[]).includes(info.mode)) progress.tried(info.mode)
  }
})
