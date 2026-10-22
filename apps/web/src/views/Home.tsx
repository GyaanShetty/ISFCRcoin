import { useEffect, useState } from 'react'
import { ConsensusMode, HOST_ATTESTED_MODES } from '@isfcr/core'
import { api, type AccountView, type BlockSummary } from '../api'
import { Big } from '../components/Big'
import { StakePanel } from '../components/StakePanel'
import { VoteCard } from '../components/Governance'
import { LotteryPanel } from '../components/LotteryPanel'
import { Tip } from '../components/Tip'
import { GamePanel } from '../components/GamePanel'
import { coins, compact, leadingZeroBits } from '../format'
import { useLive } from '../live'
import { miner, useMiner } from '../miner'
import { useWallet } from '../wallet'

export function Home() {
  const { key } = useWallet()
  const live = useLive()
  const m = useMiner()
  const [acct, setAcct] = useState<AccountView | null>(null)
  const [ranks, setRanks] = useState<{ address: string; blocks: number }[]>([])
  const [recent, setRecent] = useState<BlockSummary[]>([])

  useEffect(() => {
    if (key) api.account(key.address).then(setAcct).catch(() => {})
  }, [key?.address, live.tipVersion, live.mempoolVersion])
  useEffect(() => {
    api.leaderboard().then(setRanks).catch(() => {})
    api.chain(14).then(setRecent).catch(() => {})
  }, [live.tipVersion])

  const myBlocks = ranks.find((r) => r.address === key?.address)?.blocks ?? 0
  const total = ranks.reduce((s, r) => s + r.blocks, 0)
  const [rate, rateUnit] = compact(m.rate)
  // What to show depends on how the *next* block is made, so the switch block itself gets made.
  const mode = live.info?.nextMode ?? live.info?.mode ?? ConsensusMode.GlobalPoW
  const powMode = mode === ConsensusMode.GlobalPoW || mode === ConsensusMode.DynamicPoW
  const posMode = mode === ConsensusMode.PoS
  const lotteryMode = mode === ConsensusMode.VRFLottery
  const gameMode = (HOST_ATTESTED_MODES as readonly number[]).includes(mode)
  const next = m.template?.block
  const dynamic = next?.header.mode === ConsensusMode.DynamicPoW
  const zeros = m.hash ? leadingZeroBits(m.hash) : 0
  const needed = next ? leadingZeroBits(next.header.target.padStart(64, '0')) : 0
  const pending = acct ? acct.nextNonce - acct.nonce : 0
  // Expected hashes for *your* block: in Dynamic PoW the host scales this to your speed.
  const myWork = next ? Number((1n << 256n) / (BigInt('0x' + next.header.target) + 1n)) : 0

  return (
    <div className="stack">
      {!powMode && !posMode && !lotteryMode && !gameMode && <div className="banner warn">The class is in <b>{live.info?.modeName}</b> mode. Hash mining is paused for this round.</div>}
      {dynamic && (
        <div className="banner switch">
          <b>Dynamic PoW</b>: your target is scaled to your speed, so a phone and a gaming laptop get about the same odds.
          {m.creditedRate > 0 && <> The host credits you with {compact(m.creditedRate).join('')}H/s.</>}
        </div>
      )}
      {m.mining && m.hidden && <div className="banner warn">Keep this tab open with the screen on, or your phone will slow mining down.</div>}

      <VoteCard />

      <Tip id="home-balance">These are your coins. Your first 100 arrive with the next block, in about 15 seconds.</Tip>
      <section className="card">
        <div className="row between">
          <span className="muted">Balance</span>
          <a href="#/wallet"><button className="small white">Send</button></a>
        </div>
        <div style={{ marginTop: 10 }}>
          <Big v={acct ? coins(acct.balance) : '…'} small="ISFCR" size="xl" />
        </div>
        {pending > 0 && <div className="hint" style={{ marginTop: 8 }}>{pending} transaction{pending > 1 ? 's' : ''} waiting to be mined</div>}
      </section>

      {posMode ? <StakePanel acct={acct} /> : lotteryMode ? <LotteryPanel /> : gameMode ? <GamePanel /> : (
        <>
      <div className="grid2">
        <div className="tile orange">
          <span className="label">Blocks won</span>
          <Big v={String(myBlocks)} sup={total ? `/${total}` : undefined} />
          <span className="foot">this session</span>
        </div>
        <div className="tile blue">
          <span className="label">Your speed</span>
          <Big v={m.mining ? rate : '0'} sup={`${m.mining ? rateUnit : ''}H/s`} />
          <span className="foot">{dynamic
            ? `your target: ${compact(myWork).join('')} hashes`
            : live.info ? `${compact(live.info.difficulty).join('')} hashes per block` : ''}</span>
        </div>
      </div>

      {!m.mining && (
        <Tip id="home-mine">Tap this to start. Your phone guesses numbers until one is lucky enough to win the next block and its coins.</Tip>
      )}
      <button className={`mine-btn ${m.mining ? 'on' : ''}`} disabled={!m.template || !powMode} onClick={miner.toggle}>
        {m.mining ? <><span className="pulse" /> Mining… tap to stop</> : 'Start mining'}
      </button>

      {m.mining && (
        <Tip id="home-mining" point="none">Keep this screen open. Someone in the room wins a block roughly every 15 seconds, and any of them could be yours.</Tip>
      )}
      {m.mining && m.hash && (
        <section className="card">
          <div className="row between">
            <span className="muted">Latest guess</span>
            <span className="chip">{zeros} / {needed} zero bits</span>
          </div>
          <div className="hashline">
            <span className="z">{m.hash.slice(0, Math.floor(zeros / 4))}</span>{m.hash.slice(Math.floor(zeros / 4))}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>{m.tries.toLocaleString()} guesses so far. You win when a hash starts with enough zeros.</div>
        </section>
      )}

      {m.found.length > 0 && (
        <div className="pills">
          {m.found.slice(0, 4).map((f, i) => (
            <span key={i} className={`chip ${f.status === 'added' ? 'ok' : 'bad'}`}>
              #{f.height} {f.status === 'added' ? 'won' : f.status}
            </span>
          ))}
        </div>
      )}

      {next && (
        <a href="#/learn/block" className="tile paper" style={{ textDecoration: 'none' }}>
          <div className="row between">
            <span className="label">Your next block</span>
            <span className="foot">Look inside ›</span>
          </div>
          <Big v={`#${next.header.height}`} size="md" />
          <span className="foot">{next.txs.length - 1} transactions · prize {coins(BigInt(m.template!.reward) + BigInt(m.template!.fees))} ISFCR</span>
        </a>
      )}

        </>
      )}

      <BlockTimes recent={recent} me={key?.address} />
    </div>
  )
}

function BlockTimes({ recent, me }: { recent: BlockSummary[]; me?: string }) {
  const rows = recent.slice(1).map((b, i) => ({ h: b.height, s: Math.max(0, (b.timestamp - recent[i].timestamp) / 1000), mine: b.proposer === me }))
  if (rows.length === 0) return null
  // Cap the scale so one slow block doesn't flatten the rest; taller bars just fill the column.
  const max = Math.min(60, Math.max(30, ...rows.map((r) => r.s)))
  return (
    <section className="card">
      <div className="row between">
        <h3>Seconds per block</h3>
        <span className="hint">last {rows.length}</span>
      </div>
      <div className="chart">
        <div className="target" style={{ bottom: `${22 + (15 / max) * 148}px` }}><span>15s goal</span></div>
        {rows.map((r) => (
          <div className="col" key={r.h}>
            <div className={`bar ${r.mine ? 'mine' : ''}`} style={{ height: `${Math.min(100, Math.max(6, (r.s / max) * 100))}%` }}>
              {r.s >= max * 0.18 && <span className="v">{Math.round(r.s)}</span>}
            </div>
            <span className="x">{r.h}</span>
          </div>
        ))}
      </div>
      <div className="legend"><span><i style={{ background: 'var(--orange)' }} />you</span><span><i style={{ background: 'var(--card-2)' }} />others</span></div>
    </section>
  )
}
