import { useEffect, useState } from 'react'
import { initials, modeName } from './format'
import { useLive } from './live'
import { useWallet } from './wallet'
import { Home } from './views/Home'
import { Learn } from './views/Learn'
import { Onboarding } from './views/Onboarding'
import { Projector } from './views/Projector'
import { Admin } from './views/Admin'
import { Ranks } from './views/Ranks'
import { Wallet } from './views/Wallet'
import './miner' // start following the chain so the miner is ready on any tab

const TABS = [
  { id: 'mine', label: 'Mine' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'learn', label: 'Learn' },
  { id: 'ranks', label: 'Ranks' },
] as const

const route = () => {
  const [tab, ...rest] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')
  return { tab: tab || 'mine', sub: rest.join('/') }
}

export function App() {
  const [{ tab, sub }, setRoute] = useState(route())
  const live = useLive()
  const { key, name } = useWallet()
  useEffect(() => {
    const on = () => { setRoute(route()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  if (tab === 'projector') return <Projector />
  if (tab === 'admin') return <Admin />
  if (!key || !name) return <div className="app"><Onboarding /></div>
  const info = live.info

  return (
    <div className="app">
      <header className="top">
        <div className="hello">
          <div className="avatar">{initials(name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="name">Hi, {name}</div>
            <div className="sub">ISFCRcoin · block #{info?.height ?? '…'}</div>
          </div>
        </div>
        <span className="status"><span className={`dot ${live.connected ? 'on' : ''}`} />{info ? modeName(info.mode) : 'offline'}</span>
      </header>
      {info?.scheduledSwitch && (
        <div className="banner switch" style={{ marginBottom: 12 }}>
          Switching to <b>{modeName(info.scheduledSwitch.mode)}</b> at block {info.scheduledSwitch.activateAt}
        </div>
      )}
      <main>
        {/* #/present?code=… (the projector's QR code) lands on Home, where the presence screen reads the code. */}
        {tab === 'wallet' ? <Wallet /> : tab === 'learn' ? <Learn sub={sub} /> : tab === 'ranks' ? <Ranks /> : <Home />}
      </main>
      <nav className="nav">
        {TABS.map((t) => <a key={t.id} href={`#/${t.id}`} className={t.id === tab || (t.id === 'mine' && tab === 'present') ? 'on' : ''}>{t.label}</a>)}
      </nav>
    </div>
  )
}
