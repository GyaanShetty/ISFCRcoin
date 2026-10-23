import { useSyncExternalStore } from 'react'

/** Toasts ("what just happened"), the win celebration, and the rule-change sheet. */
export interface Toast { id: number; title: string; body: string; tone: 'win' | 'coins' | 'info' | 'warn'; group?: string }
interface NotifyState {
  toasts: Toast[]
  celebrate: { height: number; key: number } | null
  sheet: number | null // consensus mode whose explanation is open
}

let state: NotifyState = { toasts: [], celebrate: null, sheet: null }
const listeners = new Set<() => void>()
const set = (p: Partial<NotifyState>) => {
  state = { ...state, ...p }
  listeners.forEach((l) => l())
}
let seq = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export const notify = {
  toast(t: Omit<Toast, 'id'>) {
    // A toast in the same group replaces the visible one instead of piling up.
    const existing = t.group ? state.toasts.find((x) => x.group === t.group) : undefined
    const id = existing?.id ?? ++seq
    const rest = state.toasts.filter((x) => x.id !== id)
    set({ toasts: [{ ...t, id }, ...rest].slice(0, 2) })
    clearTimeout(timers.get(id))
    timers.set(id, setTimeout(() => notify.dismiss(id), 6000))
  },
  dismiss(id: number) {
    set({ toasts: state.toasts.filter((t) => t.id !== id) })
  },
  celebrate(height: number) {
    set({ celebrate: { height, key: ++seq } })
    setTimeout(() => set({ celebrate: null }), 2200)
  },
  openSheet(mode: number) { set({ sheet: mode }) },
  closeSheet() { set({ sheet: null }) },
}

export function useNotify(): NotifyState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
}
