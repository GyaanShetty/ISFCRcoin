import { useSyncExternalStore } from 'react'

/**
 * Learning progress, kept in this browser: which rulesets you've taken part in, which
 * lesson checks you've passed, which rule-change explanations you've seen, wins per mode.
 */
interface Progress {
  tried: number[]
  passed: number[]
  introduced: number[]
  wins: Record<number, number>
}

const KEY = 'isfcr.progress.v1'
const empty: Progress = { tried: [], passed: [], introduced: [], wins: {} }

function load(): Progress {
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return empty
  }
}

let state = load()
const listeners = new Set<() => void>()
const set = (p: Partial<Progress>) => {
  state = { ...state, ...p }
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* private mode */ }
  listeners.forEach((l) => l())
}
const add = (list: number[], x: number) => (list.includes(x) ? list : [...list, x])

export const progress = {
  tried: (mode: number) => { if (!state.tried.includes(mode)) set({ tried: add(state.tried, mode) }) },
  passed: (mode: number) => set({ passed: add(state.passed, mode) }),
  introduced: (mode: number) => set({ introduced: add(state.introduced, mode) }),
  win: (mode: number) => set({ wins: { ...state.wins, [mode]: (state.wins[mode] ?? 0) + 1 } }),
  get: () => state,
}

export function useProgress(): Progress {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
}
