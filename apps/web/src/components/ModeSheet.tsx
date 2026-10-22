import { lessonFor } from '../teach'
import { notify, useNotify } from '../notify'
import { progress } from '../progress'
import { FlowSteps } from './FlowSteps'

/** Bottom sheet explaining the current rules. Opens on its own when the class switches modes. */
export function ModeSheet() {
  const { sheet } = useNotify()
  const lesson = sheet === null ? undefined : lessonFor(sheet)
  if (!lesson) return null
  const close = () => {
    progress.introduced(lesson.mode)
    notify.closeSheet()
  }
  return (
    <div className="sheet-backdrop" onClick={close}>
      <section className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={lesson.title}>
        <div className="sheet-grip" />
        <span className="muted">New rules</span>
        <h1>{lesson.title}</h1>
        <p className="sheet-short">{lesson.short}</p>
        <FlowSteps steps={lesson.steps} />
        <dl className="sheet-facts">
          <dt>On your phone</dt><dd>{lesson.you}</dd>
          <dt>Watch for</dt><dd>{lesson.watch}</dd>
          <dt>How it breaks</dt><dd>{lesson.breaks}</dd>
        </dl>
        <div className="grid2">
          <button className="primary" onClick={close}>Got it</button>
          <a href={`#/learn/lessons/${lesson.mode}`} onClick={close}><button style={{ width: '100%' }}>Full lesson</button></a>
        </div>
      </section>
    </div>
  )
}
