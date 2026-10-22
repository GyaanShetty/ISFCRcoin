import { describe, expect, it } from 'vitest'
import { generateKeyPair } from '@isfcr/core'
import { DifficultyService } from '../src/difficulty'

describe('DifficultyService', () => {
  const now = 1_000_000
  const a = generateKeyPair().address
  const b = generateKeyPair().address

  it('gives each miner work proportional to its hashrate (equal odds)', () => {
    const d = new DifficultyService()
    d.record(a, 0, now - 60_000) // first seen a minute ago
    d.record(b, 0, now - 60_000)
    d.record(a, 300, now - 1000)
    d.record(b, 30, now - 1000)
    const ratio = d.workFor(a, now) / d.workFor(b, now)
    expect(ratio).toBeCloseTo(10, 5)
    // Two miners, 15 s each: a's work is its hashrate × 2 × 15.
    expect(d.workFor(a, now)).toBeCloseTo(d.hashrate(a, now) * 2 * 15, 0)
  })

  it('does not trust a single early share', () => {
    const d = new DifficultyService()
    d.record(a, 1, now)
    // One share (65,536 hashes) over the 15 s minimum window, not over ~0 s.
    expect(d.hashrate(a, now)).toBeCloseTo(65_536 / 15, 0)
  })

  it('pulls difficulty up fast when blocks come instantly', () => {
    const d = new DifficultyService()
    for (let i = 0; i < 10; i++) d.onBlock(0)
    expect(d.scale).toBe(1024)
    d.clear()
    expect(d.scale).toBe(1)
  })

  it('eases off when blocks are slow', () => {
    const d = new DifficultyService()
    for (let i = 0; i < 20; i++) d.onBlock(60_000)
    expect(d.scale).toBeLessThan(0.1)
  })

  it('stays calibrated under realistic (exponential) block times', () => {
    // Deterministic LCG so the test never flakes.
    let seed = 42
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) + 0.5) / 2 ** 32
    const d = new DifficultyService()
    const scales: number[] = []
    for (let i = 0; i < 2000; i++) {
      // A perfectly sized target: block time ~ Exp(mean 15 s) / scale. The service should settle near 1.
      d.onBlock((-Math.log(rand()) * 15_000) * d.scale)
      scales.push(d.scale)
    }
    const late = scales.slice(500)
    const geo = Math.exp(late.reduce((s, x) => s + Math.log(x), 0) / late.length)
    expect(geo).toBeGreaterThan(0.8)
    expect(geo).toBeLessThan(1.25)
  })
})
