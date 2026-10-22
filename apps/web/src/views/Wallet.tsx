import { useEffect, useState } from 'react'
import { type SignedTx, TxType, bytesToHex, isValidAddress, parseISFCR, signTx, txId, txSigningBytes } from '@isfcr/core'
import { api, type AccountView } from '../api'
import { Big } from '../components/Big'
import { coins, short } from '../format'
import { useLive } from '../live'
import { useWallet, wallet } from '../wallet'
import { ShowTipsAgain, Tip } from '../components/Tip'
import { Activity } from '../components/Activity'

export function Wallet() {
  const { key } = useWallet()
  const live = useLive()
  const [acct, setAcct] = useState<AccountView | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (key) api.account(key.address).then(setAcct).catch(() => {})
  }, [key?.address, live.tipVersion, live.mempoolVersion])
  if (!key) return null

  return (
    <div className="stack">
      <section className="card">
        <span className="muted">Balance</span>
        <div style={{ margin: '10px 0 14px' }}><Big v={acct ? coins(acct.balance) : '…'} small="ISFCR" size="xl" /></div>
        <div className="grid2">
          <div className="tile dark" style={{ minHeight: 96 }}>
            <span className="label">Staked</span>
            <Big v={acct ? coins(acct.stake) : '…'} size="md" />
          </div>
          <div className="tile dark" style={{ minHeight: 96 }}>
            <span className="label">Sent</span>
            <Big v={acct ? String(acct.nonce) : '…'} size="md" small="txs" />
          </div>
        </div>
      </section>

      <Tip id="wallet-send">To send coins, ask a classmate for their address. It's under Receive on their phone.</Tip>
      <Send nextNonce={acct?.nextNonce ?? 0} chainId={live.info?.chainId} />

      <Activity />

      <section className="card stack">
        <h3>Receive</h3>
        <p className="hint" style={{ margin: 0 }}>Share this address so classmates can send you ISFCR.</p>
        <code className="mono wrap">{key.address}</code>
        <button className="white" onClick={() => { navigator.clipboard?.writeText(key.address).then(() => setCopied(true)).catch(() => {}) }}>
          {copied ? 'Copied' : 'Copy address'}
        </button>
      </section>

      <KeyBackup />
      <ShowTipsAgain />
    </div>
  )
}

function Send({ nextNonce, chainId }: { nextNonce: number; chainId?: string }) {
  const { key } = useWallet()
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState('0.1')
  const [last, setLast] = useState<SignedTx | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!key || !chainId) return null

  async function send() {
    setErr('')
    setBusy(true)
    try {
      if (!isValidAddress(to)) throw new Error('That doesn’t look like an isfcr1… address')
      const tx = signTx({ chainId: chainId!, nonce: nextNonce, fee: parseISFCR(fee), body: { type: TxType.Transfer, to, amount: parseISFCR(amount) } }, key!.privateKey, key!.publicKey)
      await api.submitTx(tx)
      setLast(tx)
      setAmount('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack">
      <h3>Send</h3>
      <label className="field"><span>To</span><input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="isfcr1…" /></label>
      <label className="field"><span>Amount</span><input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="0.0" /></label>
      <details>
        <summary>Fee: {fee} ISFCR</summary>
        <div className="pills" style={{ marginTop: 10 }}>
          {['0.1', '0.5', '1', '2'].map((f) => <button key={f} className={fee === f ? 'on' : ''} onClick={() => setFee(f)}>{f}</button>)}
        </div>
        <p className="hint">Miners pick the highest fees first, so a bigger fee gets your transaction in sooner.</p>
      </details>
      <button className="primary" disabled={busy || !to || !amount} onClick={send}>{busy ? 'Sending…' : 'Sign & send'}</button>
      {err && <div className="error">{err}</div>}
      {last && (
        <div className="stack">
          <div className="ok">Sent. It goes through when the next block is made.</div>
          <details>
            <summary>See what you signed</summary>
            <p className="hint">Your key signed these exact bytes. Change one and the signature breaks.</p>
            <code className="mono wrap">{bytesToHex(txSigningBytes(last))}</code>
            <p className="hint">Signature: <span className="mono wrap">{short(bytesToHex(last.signature), 16)}</span><br />Tx id: <span className="mono">{short(txId(last), 12)}</span></p>
          </details>
        </div>
      )}
    </section>
  )
}

function KeyBackup() {
  const [reveal, setReveal] = useState(false)
  return (
    <section className="card">
      <details>
        <summary>Key backup</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <p className="hint" style={{ margin: 0 }}>Anyone with this key can spend your coins. Save it if you want to use another device.</p>
          {reveal ? <code className="mono wrap">{wallet.exportHex()}</code> : <button onClick={() => setReveal(true)}>Show private key</button>}
          <button className="ghost bad" onClick={() => {
            if (confirm('Sign out and forget this key on this device?')) { wallet.forget(); wallet.setName(null); wallet.setToken(null) }
          }}>Sign out &amp; forget key</button>
        </div>
      </details>
    </section>
  )
}
