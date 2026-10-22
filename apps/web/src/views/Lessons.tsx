import { useState } from 'react'
import { FlowSteps } from '../components/FlowSteps'
import { GLOSSARY, LESSONS, lessonFor } from '../teach'
import { progress, useProgress } from '../progress'

/** All nine rulesets: what you've tried and which checks you've passed. */
export function Lessons({ sub }: { sub: string }) {
  const p = useProgress()
  const mode = sub ? Number(sub) : NaN
  if (!Number.isNaN(mode) && lessonFor(mode)) return <LessonPage mode={mode} />
  return (
    <div className="stack">
      <div className="list card">
        {LESSONS.map((l) => (
          <a key={l.mode} href={`#/learn/lessons/${l.mode}`} className="item lesson-row">
            <div className="main" style={{ flex: 1 }}>
              <div className="t">{l.title}</div>
              <div className="s">{l.short}</div>
            </div>
            <div className="lesson-marks">
              <span className={`mark ${p.tried.includes(l.mode) ? 'on' : ''}`} title="tried in class">Tried</span>
              <span className={`mark ${p.passed.includes(l.mode) ? 'on' : ''}`} title="check passed">Passed</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

function LessonPage({ mode }: { mode: number }) {
  const l = lessonFor(mode)!
  const p = useProgress()
  const [pick, setPick] = useState<number | null>(null)
  const right = pick === l.check.answer
  return (
    <div className="stack">
      <section className="card stack">
        <h2>{l.title}</h2>
        <p style={{ margin: 0 }}>{l.short}</p>
        <FlowSteps steps={l.steps} />
      </section>
      <section className="card">
        <dl className="sheet-facts" style={{ margin: 0 }}>
          <dt>On your phone</dt><dd>{l.you}</dd>
          <dt>Watch for</dt><dd>{l.watch}</dd>
          <dt>How it breaks</dt><dd>{l.breaks}</dd>
          {(p.wins[mode] ?? 0) > 0 && (<><dt>Your blocks</dt><dd>You've made {p.wins[mode]} block{p.wins[mode] === 1 ? '' : 's'} under these rules.</dd></>)}
        </dl>
      </section>
      <section className="card stack">
        <div className="row between"><h3>Check yourself</h3>{p.passed.includes(mode) && <span className="chip ok">passed</span>}</div>
        <p style={{ margin: 0 }}>{l.check.q}</p>
        <div className="choices">
          {l.check.choices.map((c, i) => (
            <button key={i} className={pick === null ? '' : i === l.check.answer ? 'right' : i === pick ? 'wrong' : ''}
              onClick={() => { setPick(i); if (i === l.check.answer) progress.passed(mode) }}>{c}</button>
          ))}
        </div>
        {pick !== null && <p className={right ? 'ok' : 'error'} style={{ margin: 0 }}>{right ? 'Right. ' : 'Not quite. '}{l.check.why}</p>}
      </section>
    </div>
  )
}

export function Glossary() {
  const [q, setQ] = useState('')
  const rows = GLOSSARY.filter(([t, d]) => (t + d).toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="stack">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms" />
      <section className="card">
        <dl className="glossary">
          {rows.map(([t, d]) => (<div key={t}><dt>{t}</dt><dd>{d}</dd></div>))}
        </dl>
      </section>
    </div>
  )
}
