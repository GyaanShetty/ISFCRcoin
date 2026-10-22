import { useSyncExternalStore } from 'react'

/** Toasts ("what just happened"), the win celebration, and the rule-change sheet. */
export interface Toast { id: number; title: string; body: string; tone: 'win' | 'coins' | 'info' | 'warn' }
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

export const notify = {
  toast(t: Omit<Toast, 'id'>) {
    const id = ++seq
    set({ toasts: [{ ...t, id }, ...state.toasts].slice(0, 2) })
    setTimeout(() => notify.dismiss(id), 6000)
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
