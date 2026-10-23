import { useState } from 'react'
import { api } from '../api'
import { useLive } from '../live'
import { useWallet, wallet } from '../wallet'
import { Tip } from '../components/Tip'
import { Logo } from '../components/Logo'

/** One step: pick a name, and we create the key, join the session and claim the faucet. */
export function Onboarding() {
  const live = useLive()
  const { key, token } = useWallet()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const needsCode = live.info ? !live.info.openJoin : false

  async function go() {
    setBusy(true)
    setErr('')
    try {
      const k = key ?? wallet.create()
      const joinNow = async () => (await api.join(needsCode ? code : name, name.trim())).token
      let t = token ?? (await joinNow())
      wallet.setToken(t)
      const claim = async () => {
        try {
          await api.faucet(t, k.address)
        } catch (e) {
          const m = (e as Error).message
          if (!/already claimed/.test(m)) throw e
          // Claimed by this same key before (rejoining) is fine; by another device means the name is taken.
          if (!m.includes(k.address)) {
            wallet.setToken(null)
            throw new Error(`The name “${name.trim()}” is already used on another device. Pick a different name.`)
          }
        }
      }
      try {
        await claim()
      } catch (e) {
        // A saved token from an older session (server reset): join again and retry once.
        if (!/not joined/.test((e as Error).message)) throw e
        t = await joinNow()
        wallet.setToken(t)
        await claim()
      }
      wallet.setName(name.trim())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome stack">
      <div className="hero">
        <div className="hero-logo"><Logo size={88} animate /></div>
        <h1>ISFCRcoin</h1>
        <p>The class blockchain. Everyone in the room takes turns making the next block.</p>
      </div>
      <Tip id="onboard-name">Pick any name. No email or password needed.</Tip>
      <div className="card stack">
        <label className="field"><span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Asha" autoFocus />
        </label>
        {needsCode && (
          <label className="field"><span>Join code from your instructor</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" />
          </label>
        )}
        <button className="primary mine-btn" disabled={busy || !name.trim() || (needsCode && !code)} onClick={go}>
          {busy ? 'Joining' : 'Join'}
        </button>
        {err && <div className="error">{err}</div>}
        <p className="hint">We create a private key that stays in this browser. Your address is derived from it.</p>
      </div>
    </div>
  )
}
