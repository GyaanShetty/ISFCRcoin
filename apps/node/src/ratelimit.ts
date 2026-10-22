/** Tiny in-memory fixed-window limiter, keyed by client IP + bucket. No dependencies. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>()

  constructor(private now: () => number = Date.now) {
    setInterval(() => this.sweep(), 60_000).unref?.()
  }

  /** Returns true if the request is allowed. `limit` <= 0 disables the check. */
  allow(key: string, limit: number, windowMs: number): boolean {
    if (limit <= 0) return true
    const t = this.now()
    const h = this.hits.get(key)
    if (!h || t >= h.reset) {
      this.hits.set(key, { n: 1, reset: t + windowMs })
      return true
    }
    h.n++
    return h.n <= limit
  }

  /** Count without consuming (used for failed-login lockout). */
  blocked(key: string, limit: number): boolean {
    const h = this.hits.get(key)
    return !!h && this.now() < h.reset && h.n >= limit
  }

  private sweep(): void {
    const t = this.now()
    for (const [k, h] of this.hits) if (t >= h.reset) this.hits.delete(k)
  }
}
