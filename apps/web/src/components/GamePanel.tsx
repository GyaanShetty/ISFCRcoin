import { useEffect, useState } from 'react'
import { ConsensusMode } from '@isfcr/core'
import { api } from '../api'
import { Big } from './Big'
import { Tip } from './Tip'
import { shortAddr } from '../format'
import { useLive } from '../live'
import { act, lockAnswer, useRound } from '../round'
import { useWallet } from '../wallet'

function useNames() {
  const live = useLive()
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => { api.names().then(setNames).catch(() => {}) }, [live.tipVersion])
  return names
}

function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

/** Home panel for the host-run modes: Knowledge, Quiz-to-Vote, Presence, Vouching, PoET. */
export function GamePanel() {
  const r = useRound()
  const { key } = useWallet()
  const names = useNames()
  const now = useNow()
  const s = r.status
  if (!s?.active) return <section className="card muted">Waiting for the round to start</section>
  const me = key?.address
  const name = (a: string) => (a === me ? 'You' : names[a] ?? shortAddr(a))
  const secs = Math.max(0, Math.ceil(((s.opensAt ?? 0) - now) / 1000))

  return (
    <>
      {s.winner && (
        <div className={`banner ${s.winner === me ? 'switch' : ''}`}>
          {s.winner === me ? `You won block ${s.height}. Your phone is making it now.` : `${name(s.winner)} won block ${s.height}.`}
        </div>
      )}
      {s.mode === ConsensusMode.PoET && <PoET now={now} name={name} />}
      {s.mode === ConsensusMode.PoP && <Presence secs={secs} />}
      {s.mode === ConsensusMode.PoK && <Knowledge secs={secs} />}
      {s.mode === ConsensusMode.QtV && <QuizVote secs={secs} name={name} />}
      {s.mode === ConsensusMode.PoV && <Vouch secs={secs} name={name} />}
      {r.won.length > 0 && (
        <div className="pills">
          {r.won.slice(0, 4).map((w, i) => <span key={i} className={`chip ${w.status === 'added' ? 'ok' : 'bad'}`}>#{w.height} {w.status === 'added' ? 'won' : w.status}</span>)}
        </div>
      )}
      {r.msg && <div className="hint">{r.msg}</div>}
    </>
  )
}

function useAction() {
  const [msg, setMsg] = useState('')
  const run = async (f: () => Promise<unknown>, ok = '') => {
    try { await f(); setMsg(ok) } catch (e) { setMsg((e as Error).message) }
  }
  return { msg, run }
}

function PoET({ now, name }: { now: number; name: (a: string) => string }) {
  const s = useRound().status!
  const mine = s.myWaitMs != null ? Math.max(0, (s.startedAt ?? now) + s.myWaitMs - now) : null
  const best = s.shortest
  return (
    <>
      <Tip id="poet">Nothing to do. The host's timer gave everyone a random wait, and whoever's timer runs out first wins. You are trusting that the timer is fair.</Tip>
      <div className="grid2">
        <div className="tile orange">
          <span className="label">Your timer</span>
          <Big v={mine == null ? '…' : (mine / 1000).toFixed(1)} sup="s" />
          <span className="foot">{s.entrants ?? 0} timers running</span>
        </div>
        <div className="tile blue">
          <span className="label">Shortest timer</span>
          <Big v={best ? name(best.address) : '…'} size="name" />
          <span className="foot">{best ? `${Math.max(0, (best.at - now) / 1000).toFixed(1)}s left` : ''}</span>
        </div>
      </div>
    </>
  )
}

function Presence({ secs }: { secs: number }) {
  const s = useRound().status!
  const [code, setCode] = useState(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('code') ?? '')
  const { msg, run } = useAction()
  return (
    <>
      <Tip id="pop">Type the code shown on the projector, or point your phone's camera at the QR code. It changes every 10 seconds, so only people in the room can join in.</Tip>
      <div className="grid2">
        <div className={`tile ${s.checkedIn ? 'paper' : 'orange'}`}>
          <span className="label">You</span>
          <Big v={s.checkedIn ? 'In the room' : 'Not checked in'} size="name" />
          <span className="foot">{s.present ?? 0} people checked in</span>
        </div>
        <div className="tile blue">
          <span className="label">Draw in</span>
          <Big v={String(secs)} sup="s" />
          <span className="foot">one person in the room is picked</span>
        </div>
      </div>
      {!s.checkedIn && (
        <section className="card stack">
          <label className="field"><span>Code on the projector</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} autoCapitalize="characters" placeholder="ABC123" style={{ fontSize: 24, letterSpacing: '.2em' }} />
          </label>
          <button className="primary" disabled={code.length < 6} onClick={() => run(() => act('present', { code }))}>Check in</button>
          {msg && <div className="hint">{msg}</div>}
        </section>
      )}
    </>
  )
}

function Choices({ s, onPick, disabled }: { s: NonNullable<ReturnType<typeof useRound>['status']>; onPick: (i: number) => void; disabled: boolean }) {
  return (
    <div className="choices">
      {s.choices?.map((c, i) => (
        <button key={i} disabled={disabled} onClick={() => onPick(i)}
          className={s.answer != null ? (i === s.answer ? 'right' : '') : ''}>{c}</button>
      ))}
    </div>
  )
}

function Knowledge({ secs }: { secs: number }) {
  const s = useRound().status!
  const { msg, run } = useAction()
  const closed = s.answer != null
  return (
    <>
      <Tip id="pok">Answer the question. Your answer is locked in secretly, and revealed once answers close. The fastest correct answer makes the next block.</Tip>
      <section className="card stack">
        <div className="row between"><span className="muted">Question for block {s.height}</span><span className="chip">{closed ? 'closed' : `${secs}s left`}</span></div>
        <h2 style={{ lineHeight: 1.25 }}>{s.question}</h2>
        <Choices s={s} disabled={!!s.locked || closed} onPick={(i) => run(() => lockAnswer(i), 'Locked in.')} />
        <div className="hint">{closed ? `${s.correct ?? 0} of ${s.answers ?? 0} answered correctly.` : s.locked ? 'Locked in. Wait for answers to close.' : `${s.answers ?? 0} answers locked in so far.`}</div>
        {msg && <div className="hint">{msg}</div>}
        <details>
          <summary>Why you can trust the answer</summary>
          <p className="hint">Before anyone answered, the host published a hash of the right answer plus a secret: <span className="mono wrap">{s.commitment}</span>. {closed ? `Now it has revealed the secret (${s.salt?.slice(0, 16)}…), so anyone can check the answer wasn't changed.` : 'It reveals the secret after answers close.'}</p>
        </details>
      </section>
    </>
  )
}

function QuizVote({ secs, name }: { secs: number; name: (a: string) => string }) {
  const s = useRound().status!
  const { key } = useWallet()
  const { msg, run } = useAction()
  const [choice, setChoice] = useState<number | null>(null)
  const candidates = (s.candidates as string[] | undefined) ?? []
  const closed = s.answer != null
  return (
    <>
      <Tip id="qtv">Answer the question correctly to earn a vote, then pick who should make the next block. You can also put yourself forward as a candidate.</Tip>
      <section className="card stack">
        <div className="row between"><span className="muted">Block {s.height}</span><span className="chip">{closed ? 'closed' : `${secs}s left`}</span></div>
        <h2 style={{ lineHeight: 1.25 }}>{s.question}</h2>
        <Choices s={{ ...s, answer: closed ? s.answer : choice ?? null }} disabled={!!s.voted || closed} onPick={setChoice} />
        <span className="muted">Vote for</span>
        <div className="list">
          {candidates.map((c) => (
            <button key={c} className="item" disabled={!!s.voted || closed || choice === null || c === key?.address}
              onClick={() => run(() => act('ballot', { choice, vote: c }), 'Vote cast.')}>
              <span className="t">{name(c)}</span>
              <span className="fee">{closed && s.tally ? `${s.tally[c] ?? 0} votes` : choice === null ? 'answer first' : 'vote'}</span>
            </button>
          ))}
        </div>
        {!s.standing && !closed && <button className="white" onClick={() => run(() => act('stand'), 'You are a candidate.')}>Put myself forward</button>}
        {s.voted && <div className="hint">Vote cast. Only votes with the right answer count.</div>}
        {msg && <div className="hint">{msg}</div>}
      </section>
    </>
  )
}

function Vouch({ secs, name }: { secs: number; name: (a: string) => string }) {
  const s = useRound().status!
  const { key } = useWallet()
  const { msg, run } = useAction()
  const cands = Object.entries((s.candidates as Record<string, number> | undefined) ?? {}).sort((a, b) => b[1] - a[1])
  return (
    <>
      <Tip id="pov">Vouch for the person you trust to make the next block. Your vouch counts more if you have exchanged coins with more classmates.</Tip>
      <div className="grid2">
        <div className="tile orange">
          <span className="label">Your trust</span>
          <Big v={String(s.myTrust ?? 0)} sup="/5" />
          <span className="foot">people you've traded with</span>
        </div>
        <div className="tile blue">
          <span className="label">Vouching closes</span>
          <Big v={String(secs)} sup="s" />
          <span className="foot">{s.vouchedFor ? `you vouched for ${name(s.vouchedFor)}` : 'pick someone below'}</span>
        </div>
      </div>
      <section className="card stack">
        <div className="list">
          {cands.map(([c, w]) => (
            <button key={c} className="item" disabled={!!s.vouchedFor || c === key?.address} onClick={() => run(() => act('vouch', { for: c }), 'Vouched.')}>
              <span className="t">{name(c)}</span>
              <span className="fee">{w} trust</span>
            </button>
          ))}
        </div>
        {!s.standing && <button className="white" onClick={() => run(() => act('stand'), 'You are a candidate.')}>Put myself forward</button>}
        {msg && <div className="hint">{msg}</div>}
      </section>
    </>
  )
}
