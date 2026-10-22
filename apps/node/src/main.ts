import { networkInterfaces } from 'node:os'
import { buildApi } from './api'
import { loadConfig } from './config'
import { Peer } from './gossip'
import { IsfcrNode } from './node'

const { config, warnings } = loadConfig()
for (const w of warnings) console.warn(`[config] ${w}`)

const node = new IsfcrNode(config)
node.start()
const peers = config.peers.map((url) => new Peer(node, url))
const app = await buildApi(node, peers)
await app.listen({ port: config.port, host: config.host })
peers.forEach((p) => p.connect())

const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address)
console.log(`ISFCRcoin node up: chain ${node.chain.genesis.chainId}, height ${node.chain.height}`)
console.log(`  local:  http://localhost:${config.port}`)
for (const ip of lan) console.log(`  lan:    http://${ip}:${config.port}`)
console.log(`  faucet: ${config.faucet.address}`)
console.log(`  instructor: ${config.instructor.address}${config.oldRules ? '  [OLD RULES: ignoring governance]' : ''}`)
if (peers.length) console.log(`  peers:  ${config.peers.join(', ')}${config.followPeer ? ' (following)' : ''}`)

const shutdown = async () => {
  peers.forEach((p) => p.close())
  await app.close()
  node.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
