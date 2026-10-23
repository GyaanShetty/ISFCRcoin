import { useEffect, useMemo, useRef, useState } from 'react'
import { bytesToHex, sha256, utf8ToBytes } from '@isfcr/core'

const hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)))
const bitsDiffer = (a: string, b: string) => {
  let n = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) { n += x & 1; x >>= 1 }
  }
  return n
}

// ---------------------------------------------------------------- Hash lab

/** Type anything and watch its SHA-256 fingerprint. Change one letter and about half the bits flip. */
export function HashLab() {
  const [text, setText] = useState('ISFCR pays Asha 5 coins')
  const [prev, setPrev] = useState(hex(text))
  const h = useMemo(() => hex(text), [text])
  const changed = bitsDiffer(h, prev)
  useEffect(() => {
    const t = setTimeout(() => setPrev(h), 900) // the diff stays visible for a moment
    return () => clearTimeout(t)
  }, [h])
  return (
    <div className="stack">
      <section className="card stack">
        <label className="field"><span>Your text</span>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <span className="muted">SHA-256 fingerprint</span>
        <div className="hash-grid mono">
          {h.split('').map((c, i) => (
            <span key={`${i}:${c}`} className={c !== prev[i] ? 'flip' : ''}>{c}</span>
          ))}
        </div>
        <div className="row between">
          <span className="hint">{changed ? `${changed} of 256 bits changed (${Math.round((changed / 256) * 100)}%)` : 'Edit the text: change just one letter'}</span>
          <span className="chip">{text.length} characters in, always 64 hex out</span>
        </div>
      </section>
      <section className="card">
        <dl className="sheet-facts" style={{ margin: 0 }}>
          <dt>Same input, same hash</dt><dd>Anyone can recompute it, so a hash is a fingerprint everyone agrees on.</dd>
          <dt>Tiny change, totally different hash</dt><dd>About half the bits flip, so you can't nudge the input towards a hash you want. That's why mining is guessing.</dd>
          <dt>Can't be reversed</dt><dd>Knowing the hash tells you nothing about the input. Blocks store the previous block's hash, so changing old data shows up immediately.</dd>
        </dl>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- Mine by hand

/** Proof of work by hand: change the nonce until the hash starts with enough zeros. */
export function NonceLab() {
  const [data, setData] = useState('Block 7: Asha pays Ravi 5 ISFCR')
  const [nonce, setNonce] = useState(0)
  const [zeros, setZeros] = useState(3)
  const [tries, setTries] = useState(0)
  const [running, setRunning] = useState(false)
  const stop = useRef(false)
  const h = hex(`${data}|${nonce}`)
  const ok = h.startsWith('0'.repeat(zeros))
  const lead = h.match(/^0*/)![0].length

  useEffect(() => { setTries(0) }, [data, zeros])

  const auto = async () => {
    setRunning(true)
    stop.current = false
    let n = nonce
    let t = tries
    const want = '0'.repeat(zeros)
    for (;;) {
      // Grind a batch, then let the screen update.
      for (let i = 0; i < 2000; i++) {
        n++
        t++
        if (hex(`${data}|${n}`).startsWith(want)) {
          setNonce(n); setTries(t); setRunning(false)
          return
        }
      }
      setNonce(n)
      setTries(t)
      await new Promise((r) => setTimeout(r, 16))
      if (stop.current) break
    }
    setRunning(false)
  }

  return (
    <div className="stack">
      <section className="card stack">
        <label className="field"><span>Block data</span><input value={data} onChange={(e) => setData(e.target.value)} /></label>
        <div className="row between">
          <span className="muted">Nonce</span>
          <span className="big md mono" style={{ fontSize: 30 }}>{nonce.toLocaleString()}</span>
        </div>
        <div className={`nonce-hash mono ${ok ? 'ok' : ''}`}>
          <span className="z">{h.slice(0, lead)}</span>{h.slice(lead)}
        </div>
        <div className="row between">
          <span className={ok ? 'ok' : 'muted'}>{ok ? `Valid! It starts with ${zeros} zero${zeros > 1 ? 's' : ''}.` : `Needs ${zeros} leading zero${zeros > 1 ? 's' : ''}`}</span>
          <span className="hint">{tries.toLocaleString()} tries</span>
        </div>
        <div className="grid2">
          <button onClick={() => { setNonce(nonce + 1); setTries(tries + 1) }} disabled={running}>Next nonce</button>
          {running
            ? <button className="white" onClick={() => { stop.current = true }}>Stop</button>
            : <button className="primary" onClick={auto} disabled={ok}>Mine it</button>}
        </div>
      </section>
      <section className="card stack">
        <div className="row between"><span className="muted">Difficulty</span><b>{zeros} zero{zeros > 1 ? 's' : ''}</b></div>
        <input type="range" min={1} max={5} value={zeros} onChange={(e) => setZeros(Number(e.target.value))} />
        <div className="odds">
          {[1, 2, 3, 4, 5].map((z) => (
            <div key={z} className={z === zeros ? 'on' : ''}>
              <span style={{ height: `${(Math.log(16 ** z) / Math.log(16 ** 5)) * 100}%` }} />
              <b>{(16 ** z).toLocaleString()}</b>
            </div>
          ))}
        </div>
        <p className="hint" style={{ margin: 0 }}>Average tries for each difficulty. Every extra zero is 16 times harder, because each hex digit has 16 values. The real chain tunes this so a block takes about 15 seconds for the whole class.</p>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- 51% attack race

/** Nakamoto's estimate from the Bitcoin paper (a Poisson approximation). */
function nakamoto(q: number, z: number): number {
  const p = 1 - q
  if (q >= p) return 1
  const lambda = z * (q / p)
  let sum = 1
  for (let k = 0; k <= z; k++) {
    let poisson = Math.exp(-lambda)
    for (let i = 1; i <= k; i++) poisson *= lambda / i
    sum -= poisson * (1 - Math.pow(q / p, z - k))
  }
  return Math.max(0, Math.min(1, sum))
}

/** The exact chance (Rosenfeld) that an attacker with share q ever catches up once the shop has z confirmations. */
function exactCatchUp(q: number, z: number): number {
  const p = 1 - q
  if (q >= p) return 1
  let sum = 0
  for (let k = 0; k <= z; k++) {
    let c = 1 // C(k + z - 1, k)
    for (let i = 1; i <= k; i++) c = (c * (z - 1 + i)) / i
    sum += c * (Math.pow(p, z) * Math.pow(q, k) - Math.pow(q, z) * Math.pow(p, k))
  }
  return Math.max(0, Math.min(1, 1 - sum))
}

type Race = { honest: number; attacker: number; result: 'running' | 'caught-up' | 'gave-up'; log: ('h' | 'a')[] }

/**
 * One block in the race. The attacker succeeds once its secret chain catches up with the
 * honest one after the shop has its confirmations (from there one more block puts it ahead).
 * It gives up when it falls `giveUp` blocks behind.
 */
function step(r: Race, q: number, z: number, giveUp = 12): Race {
  if (r.result !== 'running') return r
  const who = Math.random() < q ? 'a' : 'h'
  const next = { ...r, log: [...r.log, who as 'h' | 'a'], honest: r.honest + (who === 'h' ? 1 : 0), attacker: r.attacker + (who === 'a' ? 1 : 0) }
  if (next.honest >= z && next.attacker >= next.honest) next.result = 'caught-up'
  else if (next.honest - next.attacker >= giveUp) next.result = 'gave-up'
  return next
}

/**
 * The double-spend race: you pay a shop, the shop waits for some confirmations, and an
 * attacker secretly mines a chain where the payment never happened. If the secret chain
 * gets longer, it replaces the real one.
 */
export function AttackLab() {
  const [q, setQ] = useState(0.3)
  const [z, setZ] = useState(3)
  const [race, setRace] = useState<Race | null>(null)
  const [sims, setSims] = useState<number | null>(null)

  useEffect(() => {
    if (!race || race.result !== 'running') return
    const t = setTimeout(() => setRace(step(race, q, z)), 420)
    return () => clearTimeout(t)
  }, [race, q, z])

  const runMany = () => {
    let wins = 0
    for (let i = 0; i < 500; i++) {
      let r: Race = { honest: 0, attacker: 0, result: 'running', log: [] }
      for (let n = 0; r.result === 'running' && n < 4000; n++) r = step({ ...r, log: [] }, q, z, 40)
      if (r.result === 'caught-up') wins++
    }
    setSims(wins / 500)
  }

  const blocks = (n: number, cls: string) => Array.from({ length: Math.min(n, 18) }, (_, i) => <span key={i} className={`race-block ${cls}`} />)
  return (
    <div className="stack">
      <section className="card stack">
        <div className="row between"><span className="muted">Attacker's share of all hashing</span><b>{Math.round(q * 100)}%</b></div>
        <input type="range" min={5} max={60} step={5} value={q * 100} onChange={(e) => { setQ(Number(e.target.value) / 100); setSims(null) }} />
        <div className="row between"><span className="muted">Confirmations the shop waits for</span><b>{z}</b></div>
        <input type="range" min={1} max={8} value={z} onChange={(e) => { setZ(Number(e.target.value)); setSims(null) }} />
        <div className="grid2">
          <button className="primary" onClick={() => setRace({ honest: 0, attacker: 0, result: 'running', log: [] })}>Watch a race</button>
          <button onClick={runMany}>Run 500 races</button>
        </div>
      </section>

      {race && (
        <section className="card stack">
          <div className="race-row"><span className="race-label">Honest chain</span><div className="race-track">{blocks(race.honest, 'h')}</div><b>{race.honest}</b></div>
          <div className="race-row"><span className="race-label">Attacker (secret)</span><div className="race-track">{blocks(race.attacker, 'a')}</div><b>{race.attacker}</b></div>
          <div className={race.result === 'caught-up' ? 'error' : race.result === 'gave-up' ? 'ok' : 'hint'}>
            {race.result === 'running' && (race.honest < z ? `The shop is waiting: ${race.honest} of ${z} confirmations.` : 'The shop handed over the goods. Can the attacker overtake?')}
            {race.result === 'caught-up' && 'The secret chain caught up. One more block and it is longer, so it replaces the real one and the payment vanishes: a double spend.'}
            {race.result === 'gave-up' && 'The honest chain pulled 12 blocks ahead. The attacker gives up and the payment is safe.'}
          </div>
        </section>
      )}

      <section className="card stack">
        <div className="grid2">
          <div className="tile orange" style={{ minHeight: 110 }}>
            <span className="label">Attacker wins (exact)</span>
            <span className="big md">{(exactCatchUp(q, z) * 100).toFixed(z > 5 ? 2 : 1)}%</span>
            <span className="foot">Bitcoin paper's estimate: {(nakamoto(q, z) * 100).toFixed(z > 5 ? 2 : 1)}%</span>
          </div>
          <div className="tile blue" style={{ minHeight: 110 }}>
            <span className="label">In 500 races</span>
            <span className="big md">{sims === null ? '–' : `${(sims * 100).toFixed(1)}%`}</span>
          </div>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          The exact formula and 500 random races should land close together. Each confirmation cuts the attacker's odds sharply, unless they control half the hashing or more: then they win eventually, whatever you wait for.
        </p>
      </section>
    </div>
  )
}
