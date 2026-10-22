import { useState } from 'react'
import { type SignedTx, Writer, addressFromPublicKey, bytesToHex, hexToBytes, sign, txFromJSON, verify, verifyTxSignature } from '@isfcr/core'
import { useWallet } from '../wallet'

const messageBytes = (text: string) => new Writer().str('ISFCR-MSG').str(text).bytes()

export function SignVerify() {
  const { key } = useWallet()
  const [text, setText] = useState('I was here, ISFCR lab')
  const [out, setOut] = useState('')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null)
  if (!key) return null

  const check = () => {
    try {
      const j = JSON.parse(input)
      if (j.body) {
        const tx = txFromJSON(j) as SignedTx
        const ok = verifyTxSignature(tx)
        setResult({ ok, detail: `Transaction from ${addressFromPublicKey(tx.publicKey)}: signature ${ok ? 'valid' : 'INVALID'}` })
      } else {
        const pub = hexToBytes(j.publicKey)
        const ok = verify(hexToBytes(j.signature), messageBytes(j.message), pub)
        const addr = addressFromPublicKey(pub)
        const addrOk = !j.address || j.address === addr
        setResult({ ok: ok && addrOk, detail: `“${j.message}” signed by ${addr}${ok ? '' : ': INVALID'}${addrOk ? '' : ' (claimed address does not match the key!)'}` })
      }
    } catch (e) {
      setResult({ ok: false, detail: `Couldn’t read that: ${(e as Error).message}` })
    }
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h3>Sign a message</h3>
        <input value={text} onChange={(e) => setText(e.target.value)} />
        <button className="blue" onClick={() => setOut(JSON.stringify({
          message: text, address: key.address, publicKey: bytesToHex(key.publicKey), signature: bytesToHex(sign(messageBytes(text), key.privateKey)),
        }))}>Sign</button>
        {out && <textarea readOnly rows={5} className="mono" value={out} onFocus={(e) => e.target.select()} />}
        {out && <p className="hint" style={{ margin: 0 }}>Send this to a classmate. They can verify it was you without ever seeing your private key.</p>}
      </section>
      <section className="card stack">
        <h3>Verify someone else’s</h3>
        <textarea rows={5} className="mono" value={input} onChange={(e) => { setInput(e.target.value); setResult(null) }} placeholder="Paste a signed message, or a tx copied from the explorer" />
        <button className="white" onClick={check} disabled={!input}>Verify</button>
        {result && <div className={result.ok ? 'ok' : 'error'}>{result.ok ? 'Valid. ' : 'Invalid. '}{result.detail}</div>}
        <p className="hint" style={{ margin: 0 }}>Try changing one character of the message and verifying again.</p>
      </section>
    </div>
  )
}
