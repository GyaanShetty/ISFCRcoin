import { ConsensusMode, formatISFCR } from '@isfcr/core'

export const isfcr = (units: string | bigint) => `${formatISFCR(BigInt(units))} ISFCR`
export const short = (hex: string, n = 6) => (hex.length > n * 2 + 1 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex)
export const shortAddr = (a: string) => `isfcr1${a.slice(6, 12)}…${a.slice(-4)}`
export const modeName = (m: number) => ConsensusMode[m] ?? `mode ${m}`
export function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`
}
export const leadingZeroBits = (hex: string) => {
  let bits = 0
  for (const c of hex) {
    const v = parseInt(c, 16)
    if (v === 0) bits += 4
    else return bits + Math.clz32(v) - 28
  }
  return bits
}

/** Splits a number into a short value and unit for the big-numeral style: 196850 → ['197', 'k']. */
export function compact(n: number): [string, string] {
  if (n >= 1e9) return [(n / 1e9).toFixed(1), 'B']
  if (n >= 1e6) return [(n / 1e6).toFixed(n >= 1e7 ? 0 : 1), 'M']
  if (n >= 1e3) return [(n / 1e3).toFixed(n >= 1e4 ? 0 : 1), 'k']
  return [String(Math.round(n)), '']
}

/** ISFCR amount with at most 2 decimals, for headline numbers. */
export function coins(units: string | bigint): string {
  const s = formatISFCR(BigInt(units))
  const [w, f] = s.split('.')
  return f ? `${w}.${f.slice(0, 2)}` : w
}

export const initials = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'
