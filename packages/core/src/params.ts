// Protocol constants. All amounts are integer base units: 1 ISFCR = 1_000_000 units.
export const UNIT = 1_000_000n

export const PARAMS = {
  BLOCK_REWARD: 10n * UNIT,
  HALVING_INTERVAL: 100,
  MIN_FEE: UNIT / 10n,
  MAX_TXS_PER_BLOCK: 20,
  SUPPLY_CAP: 1_000_000n * UNIT,
  TARGET_BLOCK_MS: 15_000,
  RETARGET_WINDOW: 10,
  FAUCET_AMOUNT: 100n * UNIT,
  // Small on purpose: PoS slots are time-based, so a proposer must not sign early with a future timestamp.
  MAX_FUTURE_DRIFT_MS: 3_000,
} as const

export enum ConsensusMode {
  GlobalPoW = 0,
  DynamicPoW = 1,
  PoS = 2,
  VRFLottery = 3,
  PoK = 4,
  QtV = 5,
  PoP = 6,
  PoV = 7,
  PoET = 8,
}

export function blockReward(height: number): bigint {
  const halvings = Math.floor(height / PARAMS.HALVING_INTERVAL)
  return halvings >= 64 ? 0n : PARAMS.BLOCK_REWARD >> BigInt(halvings)
}

export function formatISFCR(units: bigint): string {
  const neg = units < 0n
  const abs = neg ? -units : units
  const whole = abs / UNIT
  const frac = (abs % UNIT).toString().padStart(6, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`
}

export function parseISFCR(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s.trim())
  if (!m) throw new Error(`invalid amount: ${s}`)
  return BigInt(m[1]) * UNIT + BigInt((m[2] ?? '').padEnd(6, '0'))
}
