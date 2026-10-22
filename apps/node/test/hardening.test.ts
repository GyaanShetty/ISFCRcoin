import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { RateLimiter } from '../src/ratelimit'

describe('hardening', () => {
  it('rate limiter blocks after the limit and resets after the window', () => {
    let t = 0
    const l = new RateLimiter(() => t)
    expect([1, 2, 3].map(() => l.allow('k', 2, 1000))).toEqual([true, true, false])
    t = 1001
    expect(l.allow('k', 2, 1000)).toBe(true)
    expect(l.allow('k', 0, 1000)).toBe(true) // 0 = off
  })
  it('production refuses dev secrets', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/Refusing to start/)
    expect(() => loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: 'short', FAUCET_SEED: 'a', INSTRUCTOR_SEED: 'b' })).toThrow(/12 characters/)
  })
  it('join is closed by default', () => {
    expect(loadConfig({}).config.openJoin).toBe(false)
  })
})

import { IsfcrNode } from '../src/node'

describe('roster', () => {
  it('only roster IDs can join; junk is rejected', () => {
    const node = new IsfcrNode(loadConfig({ DB_PATH: ':memory:', TXGEN: '0', INITIAL_WORK: '16' }).config)
    const r = node.importRoster(['pes1ug22cs001', ' PES1UG22CS002 ', 'x', 'bad id!', 'PES1UG22CS001'])
    expect(r.added).toBe(2)
    expect(r.rejected.length).toBe(2)
    expect(node.join('pes1ug22cs001')).toMatch(/^[0-9a-f]{32}$/)
    expect(() => node.join('NOTINROSTER')).toThrow(/unknown join code/)
    expect(() => node.join('A'.repeat(33))).toThrow(/too long/)
    node.close()
  })
})
