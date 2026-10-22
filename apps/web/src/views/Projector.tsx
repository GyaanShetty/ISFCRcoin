import { useEffect, useState } from 'react'
import { ConsensusMode } from '@isfcr/core'
import { api, type BlockSummary, type LotteryStatus, type PosStatus } from '../api'
import { Big } from '../components/Big'
import { ForkView, readPeer } from '../components/ForkView'
import { GameProjector } from '../components/GameProjector'
import { HOST_ATTESTED_MODES } from '@isfcr/core'
import { compact, initials, modeName, shortAddr } from '../format'
import { useLive } from '../live'

const WINDOW = 30
const ADMIN_KEY = 'isfcr.admin.v1'
const readToken = () => { try { return localStorage.getItem(ADMIN_KEY) ?? '' } catch { return '' } }

/** Big-screen view for the room: who is winning blocks, how fair it is, and instructor controls. */
export function Projector() {
  const live = useLive()
  const info = live.info
  const [recent, setRecent] = useState<BlockSummary[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [diff, setDiff] = useState<{ activeMiners: number; miners: { address: string; hashrate: number; work: number }[] } | null>(null)

  useEffect(() => {
    api.chain(WINDOW).then(setRecent).catch(() => {})
    api.names().then(setNames).catch(() => {})
  }, [live.tipVersion])
  const [pos, setPos] = useState<PosStatus | null>(null)
  const [lottery, setLottery] = useState<LotteryStatus | null>(null)
  useEffect(() => {
    const load = () => {
      api.difficulty().then(setDiff).catch(() => {})
      api.pos().then(setPos).catch(() => {})
      api.lottery().then(setLottery).catch(() => {})
    }
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  const blocks = recent.filter((b) => b.height > 0)
  const counts = new Map<string, number>()
  for (const b of blocks) counts.set(b.proposer, (counts.get(b.proposer) ?? 0) + 1)
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const topShare = rows.length ? rows[0][1] / blocks.length : 0
  const fairShare = rows.length ? 1 / rows.length : 0
  const name = (a: string) => names[a] ?? shortAddr(a)
  const times = blocks.slice(1).map((b, i) => (b.timestamp - blocks[i].timestamp) / 1000)
  const avg = times.length ? times.reduce((s, t) => s + t, 0) / times.length : 0

  return (
    <div className="projector">
      <header className="row between" style={{ padding: '24px 0' }}>
        <div>
          <div className="muted">ISFCRcoin testnet · {live.connected ? `${info?.clients ?? 0} connected` : 'offline'}</div>
          <h1 style={{ fontSize: 44, letterSpacing: '-0.04em' }}>Block <span style={{ color: 'var(--orange)' }}>#{info?.height ?? '…'}</span></h1>
        </div>
        <span className="status" style={{ fontSize: 20, padding: '12px 20px' }}><span className={`dot ${live.connected ? 'on' : ''}`} />{info ? modeName(info.mode) : '…'}</span>
      </header>
      {info?.scheduledSwitch && <div className="banner switch" style={{ fontSize: 20, marginBottom: 16 }}>Switching to <b>{modeName(info.scheduledSwitch.mode)}</b> at block {info.scheduledSwitch.activateAt}</div>}

      {info && (HOST_ATTESTED_MODES as readonly number[]).includes(info.nextMode) && (
        <div style={{ marginBottom: 16 }}><GameProjector names={names} /></div>
      )}
      <div className="pgrid">
        <div className="tile orange"><span className="label">Top miner's share</span><Big v={String(Math.round(topShare * 100))} sup="%" size="xl" /><span className="foot">of the last {blocks.length} blocks. A fair share would be {Math.round(fairShare * 100)}%.</span></div>
        <div className="tile blue"><span className="label">Seconds per block</span><Big v={avg ? avg.toFixed(1) : '–'} sup="s" size="xl" /><span className="foot">goal: 15s</span></div>
        <div className="tile paper"><span className="label">Miners winning</span><Big v={String(rows.length)} size="xl" /><span className="foot">{diff ? `${diff.activeMiners} sending shares` : ''}</span></div>
      </div>

      <div className="pgrid2">
        <section className="card">
          <h2>Who wins blocks <span className="hint">last {blocks.length}</span></h2>
          <div className="list" style={{ marginTop: 10 }}>
            {rows.slice(0, 10).map(([addr, n]) => (
              <div className="item" key={addr}>
                <div className="row" style={{ flexWrap: 'nowrap', minWidth: 0 }}>
                  <div className="avatar" style={{ width: 38, height: 38, fontSize: 15 }}>{initials(name(addr))}</div>
                  <span className="t">{name(addr)}</span>
                </div>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <div className="meter" style={{ width: 220, height: 14, borderRadius: 7 }}><span style={{ width: `${(100 * n) / blocks.length}%` }} /></div>
                  <span className="fee" style={{ width: 40, textAlign: 'right' }}>{n}</span>
                </div>
              </div>
            ))}
            {rows.length === 0 && <div className="muted">No blocks yet.</div>}
          </div>
        </section>
        {info?.mode === ConsensusMode.VRFLottery ? (
        <section className="card">
          <h2>Lottery draw for #{lottery?.height ?? '…'}</h2>
          <p className="hint">Lowest number wins. {lottery?.entries ?? 0} tickets entered: one per address.</p>
          <div className="list">
            {(lottery?.ranking ?? []).slice(0, 10).map((t, i) => (
              <div className="item" key={t.address}>
                <span className="t">{`${i + 1}. `}{name(t.address)}</span>
                <span className="mono">{t.value.slice(0, 10)}…</span>
              </div>
            ))}
          </div>
        </section>
        ) : info?.mode === ConsensusMode.PoS ? (
        <section className="card">
          <h2>Stake lottery</h2>
          <p className="hint">Each block's proposer is drawn by stake. Now picking: <b>{pos?.leader ? name(pos.leader) : 'nobody'}</b>{pos?.round ? ` (round ${pos.round}, first pick missed)` : ''}</p>
          {live.lastSlash && <div className="banner warn" style={{ fontSize: 18 }}>{name(live.lastSlash.proposer)} double-signed #{live.lastSlash.height}: half their stake burned</div>}
          <div className="list">
            {(pos?.stakers ?? []).slice(0, 10).map((x) => (
              <div className="item" key={x.address}>
                <span className="t">{name(x.address)}</span>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <div className="meter" style={{ width: 160, height: 14, borderRadius: 7 }}><span style={{ width: `${x.chance * 100}%`, background: 'var(--blue)' }} /></div>
                  <span className="fee" style={{ width: 48, textAlign: 'right' }}>{Math.round(x.chance * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </section>
        ) : (
        <section className="card">
          <h2>Dynamic PoW targets</h2>
          <p className="hint">Measured from shares. Faster machines get proportionally harder targets.</p>
          {info?.mode !== ConsensusMode.DynamicPoW && <p className="muted">Not active. Switch modes below to compare.</p>}
          <div className="list">
            {(diff?.miners ?? []).slice(0, 10).map((m) => (
              <div className="item" key={m.address}>
                <span className="t">{name(m.address)}</span>
                <span className="s">{compact(m.hashrate).join('')}H/s → needs {compact(m.work).join('')} hashes</span>
              </div>
            ))}
          </div>
        </section>
        )}
      </div>
      {readPeer() && <div style={{ marginTop: 16 }}><ForkView peer={readPeer()} /></div>}
      <AdminPanel />
    </div>
  )
}

function AdminPanel() {
  return (
    <div className="row" style={{ marginTop: 16 }}>
      <a href="#/admin" className="hint">Instructor controls</a>
    </div>
  )
}
