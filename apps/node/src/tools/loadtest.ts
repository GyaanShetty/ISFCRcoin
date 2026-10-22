/**
 * Load test: simulates a classroom of browser clients against a node.
 *   npm run loadtest -w @isfcr/node -- --url http://localhost:8080 --clients 150 --seconds 90
 *
 * Each client holds the live WebSocket and, whenever a new block arrives, makes the
 * same burst of requests the app's home screen does (template, balance, mempool,
 * leaderboard, recent blocks, names). Reports connection success, how long new
 * blocks take to reach every client after the first, and request latency under that burst.
 * Run headless miners alongside so blocks actually arrive.
 */
import { generateKeyPair } from '@isfcr/core'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const url = (args.get('url') ?? 'http://localhost:8080').replace(/\/$/, '')
const clients = Number(args.get('clients') ?? 150)
const seconds = Number(args.get('seconds') ?? 90)

const latencies: number[] = []
const perPath = new Map<string, { n: number; errors: number; ms: number[] }>()
const blockDelays: number[] = []
const firstSeen = new Map<string, number>() // block hash → when the first client heard of it
let errors = 0
let connected = 0
let dropped = 0
let blocksSeen = 0

async function timed(path: string): Promise<void> {
  const name = path.split('?')[0].replace(/isfcr1[0-9a-f]+/, ':addr')
  const stat = perPath.get(name) ?? { n: 0, errors: 0, ms: [] }
  perPath.set(name, stat)
  const t0 = performance.now()
  let failed = false
  try {
    const r = await fetch(url + path)
    await r.arrayBuffer()
    failed = !r.ok
  } catch {
    failed = true
  }
  const ms = performance.now() - t0
  stat.n++
  stat.ms.push(ms)
  if (failed) {
    stat.errors++
    errors++
  }
  latencies.push(ms)
}

function client(i: number): WebSocket {
  const address = generateKeyPair().address
  const ws = new WebSocket(url.replace(/^http/, 'ws') + '/ws')
  ws.onopen = () => connected++
  ws.onclose = () => dropped++
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.type === 'block' && msg.main) {
      if (i === 0) blocksSeen++
      // Fan-out: how long after the first client each other client hears about the block.
      const now = performance.now()
      const first = firstSeen.get(msg.block.hash)
      if (first === undefined) firstSeen.set(msg.block.hash, now)
      else blockDelays.push(now - first)
    }
    if (msg.type === 'tip') {
      // Spread like real phones: everyone reacts within the first second.
      setTimeout(() => {
        for (const p of [`/api/template?proposer=${address}`, `/api/state/${address}`, '/api/mempool?limit=200',
          '/api/leaderboard', '/api/chain?limit=14', '/api/names']) void timed(p)
      }, Math.random() * 1000)
    }
  }
  return ws
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))])
}

console.log(`load test: ${clients} clients for ${seconds}s against ${url}`)
const sockets: WebSocket[] = []
for (let i = 0; i < clients; i++) {
  sockets.push(client(i))
  if (i % 25 === 24) await new Promise((r) => setTimeout(r, 200)) // a class trickling in
}
await new Promise((r) => setTimeout(r, seconds * 1000))
const stillOpen = sockets.filter((s) => s.readyState === WebSocket.OPEN).length
sockets.forEach((s) => s.close())

const report = {
  clients,
  connected,
  stillOpenAtEnd: stillOpen,
  droppedDuringTest: dropped,
  blocksDuringTest: blocksSeen,
  requests: latencies.length,
  requestErrors: errors,
  requestLatencyMs: { p50: pct(latencies, 50), p95: pct(latencies, 95), p99: pct(latencies, 99), max: pct(latencies, 100) },
  blockFanOutMs: { p50: pct(blockDelays, 50), p95: pct(blockDelays, 95), max: pct(blockDelays, 100) },
  byEndpoint: Object.fromEntries([...perPath].map(([k, v]) => [k, { requests: v.n, errors: v.errors, p95ms: pct(v.ms, 95) }])),
}
console.log(JSON.stringify(report, null, 2))
process.exit(0)
