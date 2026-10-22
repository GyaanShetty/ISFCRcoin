import { useEffect, useState } from 'react'
import { api } from '../api'
import { modeName } from '../format'
import { useLive } from '../live'
import { readPeer, writePeer } from '../components/ForkView'

const KEY = 'isfcr.admin.v1'
const read = () => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } }
const write = (t: string) => { try { localStorage.setItem(KEY, t) } catch { /* private mode */ } }

interface Status { txgen: boolean; openJoin: boolean; joinCodes: number; sessions: number }

/** Instructor page: sign in with the admin token, then run the session from here. */
export function Admin() {
  const [token, setToken] = useState(read())
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')

  const check = async (t = token) => {
    try {
      setStatus(await api.adminGet<Status>(t, 'status'))
      write(t)
      setError('')
    } catch (e) {
      setStatus(null)
      setError((e as Error).message)
    }
  }
  useEffect(() => { if (token) check() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!status) {
    return (
      <div className="admin">
        <h1>Instructor</h1>
        <section className="card stack" style={{ maxWidth: 420 }}>
          <label className="field"><span>Admin token</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()} />
          </label>
          <button className="primary" onClick={() => check()} disabled={!token}>Sign in</button>
          {error && <div className="error">{error}</div>}
        </section>
      </div>
    )
  }
  return (
    <div className="admin">
      <div className="row between" style={{ padding: '24px 0 16px' }}>
        <h1>Instructor</h1>
        <a href="#/projector"><button className="white">Open projector</button></a>
      </div>
      <div className="admin-grid">
        <Consensus token={token} />
        <Session token={token} status={status} refresh={() => check()} />
        <ForkDemo />
        <Questions token={token} />
        <JoinCodes token={token} openJoin={status.openJoin} />
      </div>
    </div>
  )
}

function Consensus({ token }: { token: string }) {
  const live = useLive()
  const info = live.info
  const [msg, setMsg] = useState('')
  const modes = info?.implementedModes ?? []
  const go = async (mode: number) => {
    try {
      await api.admin(token, 'consensus', { mode, activateIn: 3 })
      setMsg(`${modeName(mode)} starts 3 blocks from now.`)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  return (
    <section className="card stack">
      <h3>Consensus</h3>
      <div className="kv"><span className="muted">Now</span><span>{info ? modeName(info.mode) : '…'} at block {info?.height ?? '…'}</span></div>
      {info?.scheduledSwitch && <div className="banner switch">{modeName(info.scheduledSwitch.mode)} from block {info.scheduledSwitch.activateAt}</div>}
      <div className="pills">
        {modes.map((m) => (
          <button key={m} className={info?.mode === m ? 'on' : ''} disabled={info?.mode === m} onClick={() => go(m)}>{modeName(m)}</button>
        ))}
      </div>
      <p className="hint" style={{ margin: 0 }}>Signed with the instructor key, so it skips the class vote. Every node switches at the same block.</p>
      {msg && <div className="hint">{msg}</div>}
    </section>
  )
}

function Session({ token, status, refresh }: { token: string; status: Status; refresh: () => void }) {
  const [msg, setMsg] = useState('')
  const [confirming, setConfirming] = useState(false)
  const run = async (path: string, body: unknown, done: string) => {
    try {
      await api.admin(token, path, body)
      setMsg(done)
      refresh()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  return (
    <section className="card stack">
      <h3>Session</h3>
      <div className="row between">
        <span>Background transactions</span>
        <button className={status.txgen ? 'white' : ''} onClick={() => run('txgen', { on: !status.txgen }, status.txgen ? 'Generator off.' : 'Generator on.')}>
          {status.txgen ? 'On' : 'Off'}
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>Bot wallets keep the mempool full so fee priority is visible. They also stake and enter the lottery, so slotted modes never stall.</p>
      <div className="row between">
        <span>Past sessions</span><span className="fee">{status.sessions}</span>
      </div>
      {!confirming ? (
        <button onClick={() => setConfirming(true)}>Reset session</button>
      ) : (
        <div className="stack">
          <p className="hint" style={{ margin: 0 }}>Starts a new chain. Balances go back to zero, the leaderboard is archived, join codes stay valid.</p>
          <div className="grid2">
            <button className="primary" onClick={() => { setConfirming(false); run('reset', {}, 'New session started.') }}>Reset now</button>
            <button onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div className="hint">{msg}</div>}
    </section>
  )
}

function Questions({ token }: { token: string }) {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const upload = async (list: unknown[]) => {
    try {
      const r = await api.admin(token, 'questions', { questions: list })
      setMsg(list.length ? `${r.questions} questions loaded.` : 'Back to the built-in questions.')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  return (
    <section className="card stack">
      <h3>Quiz questions</h3>
      <p className="hint" style={{ margin: 0 }}>Used by Proof of Knowledge and Quiz-to-Vote. Paste a JSON list, one question per item, with the index of the right choice.</p>
      <textarea rows={6} className="mono" value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'[{ "text": "What links blocks together?", "choices": ["Hashes", "Names"], "answer": 0 }]'} />
      <div className="grid2">
        <button className="primary" disabled={!text.trim()} onClick={() => {
          try { upload(JSON.parse(text)) } catch { setMsg('That isn’t valid JSON.') }
        }}>Load questions</button>
        <button onClick={() => upload([])}>Use built-in</button>
      </div>
      {msg && <div className="hint">{msg}</div>}
    </section>
  )
}

function ForkDemo() {
  const [url, setUrl] = useState(readPeer())
  const [saved, setSaved] = useState(readPeer())
  return (
    <section className="card stack">
      <h3>Hard-fork demo</h3>
      <p className="hint" style={{ margin: 0 }}>
        Run a second node with OLD_RULES=1 pointed at this one. When you switch consensus here, it refuses the new rules and its chain splits off.
        Add its address and the projector shows both chains side by side.
      </p>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://10.0.0.5:8080" />
      <div className="grid2">
        <button className="primary" onClick={() => { writePeer(url.trim()); setSaved(url.trim()) }} disabled={!url.trim()}>Show on projector</button>
        <button onClick={() => { writePeer(''); setSaved(''); setUrl('') }} disabled={!saved}>Hide</button>
      </div>
      {saved && <div className="hint">Projector compares with {saved}</div>}
    </section>
  )
}

function JoinCodes({ token, openJoin }: { token: string; openJoin: boolean }) {
  const [codes, setCodes] = useState<{ code: string; joined: boolean }[]>([])
  const [count, setCount] = useState('30')
  const load = () => api.adminGet<{ code: string; joined: boolean }[]>(token, 'joincodes').then(setCodes).catch(() => {})
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const issue = async () => {
    await api.admin(token, 'joincodes', { count: Number(count) || 1 }).catch(() => {})
    load()
  }
  const [roster, setRoster] = useState('')
  const [rosterMsg, setRosterMsg] = useState('')
  const importRoster = async () => {
    const r = await api.admin(token, 'roster', { ids: roster }).catch(() => null)
    setRosterMsg(r ? `${r.added} added${r.rejected.length ? `, ${r.rejected.length} rejected (${r.rejected.slice(0, 3).join(', ')})` : ''}` : 'failed')
    if (r) { setRoster(''); load() }
  }
  const fresh = codes.filter((c) => !c.joined)
  return (
    <section className="card stack admin-codes">
      <div className="row between">
        <h3>Join codes</h3>
        <span className="hint">{codes.length - fresh.length} used · {fresh.length} free</span>
      </div>
      {openJoin && <p className="hint" style={{ margin: 0 }}>Open join is on: any name works without a code. Set OPEN_JOIN=0 on the node to require codes.</p>}
      <div className="row">
        <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" style={{ maxWidth: 100 }} />
        <button className="primary" onClick={issue}>Issue codes</button>
        {fresh.length > 0 && <button onClick={() => window.print()}>Print</button>}
      </div>
      <textarea value={roster} onChange={(e) => setRoster(e.target.value)} rows={3} placeholder="Or paste a roster (PESU IDs, one per line): each student then joins with their own ID" />
      <div className="row">
        <button onClick={importRoster} disabled={!roster.trim()}>Import roster</button>
        {rosterMsg && <span className="hint">{rosterMsg}</span>}
      </div>
      <div className="codes">
        {codes.map((c) => <span key={c.code} className={`code ${c.joined ? 'used' : ''}`}>{c.code}</span>)}
      </div>
    </section>
  )
}

