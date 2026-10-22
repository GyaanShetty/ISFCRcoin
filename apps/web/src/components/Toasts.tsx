import { notify, useNotify } from '../notify'

/** "What just happened" notes, newest on top. Tap to dismiss. */
export function Toasts() {
  const { toasts } = useNotify()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.tone}`} onClick={() => notify.dismiss(t.id)}>
          <b>{t.title}</b>
          <span>{t.body}</span>
        </button>
      ))}
    </div>
  )
}
