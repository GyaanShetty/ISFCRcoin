import { useEffect, useState } from 'react'

/** Three numbered steps that light up one after another, on a loop, joined by a filling line. */
export function FlowSteps({ steps }: { steps: readonly string[] }) {
  const [on, setOn] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setOn((x) => (x + 1) % steps.length), 2600)
    return () => clearInterval(t)
  }, [steps.length])
  return (
    <ol className="flow">
      {steps.map((s, i) => (
        <li key={i} className={i === on ? 'on' : i < on ? 'done' : ''} onClick={() => setOn(i)}>
          <span className="flow-n">{i + 1}</span>
          <span className="flow-t">{s}</span>
        </li>
      ))}
    </ol>
  )
}
