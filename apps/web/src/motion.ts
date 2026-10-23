/**
 * Animation cool-downs. Blocks can arrive every second early in a session; animating
 * each one makes the screen look frantic. `allow(key, ms)` says whether an animation
 * of that kind may run now, and records it if so.
 */
const last = new Map<string, number>()

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function allow(key: string, ms: number): boolean {
  if (reducedMotion()) return false
  const now = Date.now()
  if (now - (last.get(key) ?? 0) < ms) return false
  last.set(key, now)
  return true
}
