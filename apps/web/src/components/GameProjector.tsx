import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ConsensusMode } from '@isfcr/core'
import { api, type RoundStatus } from '../api'
import { compact, shortAddr } from '../format'

const adminToken = () => { try { return localStorage.getItem('isfcr.admin.v1') ?? '' } catch { return '' } }

/** Projector view for the host-run modes. Proof of Presence shows the rotating code and its QR. */
export function GameProjector({ names }: { names: Record<string, string> }) {
  const [s, setS] = useState<RoundStatus | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [err, setErr] = useState('')
  const name = (a: string) => names[a] ?? shortAddr(a)

  useEffect(() => {
    const load = async () => {
      try {
        const st = await api.round()
        setS(st)
        if (st.mode === ConsensusMode.PoP) {
          const r = await api.adminGet<{ code: string | null }>(adminToken(), 'presence')
          setCode(r.code)
          setErr('')
        }
      } catch (e) {
        setErr((e as Error).message)
      }
    }
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [])

  // The QR opens the app with the code filled in, so a phone camera is all a student needs.
  useEffect(() => {
    if (!code) return
    QRCode.toString(`${location.origin}/#/present?code=${code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then(setQr).catch(() => setQr(''))
  }, [code])

  if (!s?.active) return null
  const winner = s.winner ? <div className="banner switch" style={{ fontSize: 20 }}>{name(s.winner)} won block {s.height}</div> : null

  if (s.mode === ConsensusMode.PoP) {
    return (
      <section className="card stack">
        <h2>Check in: block {s.height}</h2>
        {err && !code ? <p className="error">Sign in on the instructor page first: the code is only shown to the host. ({err})</p> : (
          <div className="pgrid2">
            <div className="qr-box" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="stack" style={{ justifyContent: 'center' }}>
              <div className="big-code">{code}</div>
              <p className="muted" style={{ textAlign: 'center', fontSize: 18 }}>Scan with your camera, or type the code. It changes every 10 seconds.</p>
              <p style={{ textAlign: 'center', fontSize: 22 }}>{s.present ?? 0} people checked in</p>
            </div>
          </div>
        )}
        {winner}
      </section>
    )
  }
  if (s.mode === ConsensusMode.PoK || s.mode === ConsensusMode.QtV) {
    return (
      <section className="card">
        <span className="muted">{s.mode === ConsensusMode.PoK ? 'Proof of Knowledge' : 'Quiz-to-Vote'} · block {s.height}</span>
        <div className="proj-question">{s.question}</div>
        <div className="proj-choices">
          {s.choices?.map((c, i) => <div key={i} className={s.answer === i ? 'right' : ''}>{String.fromCharCode(65 + i)}. {c}</div>)}
        </div>
        <p className="muted" style={{ fontSize: 18 }}>
          {s.mode === ConsensusMode.PoK
            ? `${s.answers ?? 0} answers locked in${s.correct != null ? `, ${s.correct} correct` : ''}`
            : `${s.ballots ?? 0} votes cast`}
        </p>
        {s.mode === ConsensusMode.QtV && s.tally && (
          <div className="list">{Object.entries(s.tally).sort((a, b) => b[1] - a[1]).map(([a, v]) => (
            <div className="item" key={a}><span className="t">{name(a)}</span><span className="fee">{v} votes</span></div>
          ))}</div>
        )}
        {winner}
      </section>
    )
  }
  if (s.mode === ConsensusMode.PoV) {
    return (
      <section className="card">
        <h2>Trust in the room</h2>
        <p className="hint">Trust = how many different people each address has exchanged coins with (max 5). A ring of fake accounts paying each other shows up here.</p>
        <div className="list">{(s.topTrust ?? []).map(([a, t]) => (
          <div className="item" key={a}><span className="t">{name(a)}</span>
            <div className="meter" style={{ width: 160, height: 14, borderRadius: 7 }}><span style={{ width: `${(t / 5) * 100}%` }} /></div></div>
        ))}</div>
        {winner}
      </section>
    )
  }
  if (s.mode === ConsensusMode.PoET) {
    return (
      <section className="card">
        <h2>Timers for block {s.height}</h2>
        <p className="hint">The host hands every miner a random wait. The shortest one wins. Everyone has to trust the host's timer.</p>
        <p style={{ fontSize: 22 }}>{s.entrants ?? 0} timers running{s.shortest ? `, shortest ${compact(s.shortest.waitMs / 1000).join('')}s (${name(s.shortest.address)})` : ''}</p>
        {winner}
      </section>
    )
  }
  return null
}
