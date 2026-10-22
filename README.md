# ISFCRcoin

A classroom blockchain. Students join from their phones, mine or stake ISFCR on a live campus testnet,
and the instructor switches the consensus rules mid-session, so the class tries several mechanisms
back to back on one chain.

**Consensus modes:** Global PoW, Dynamic PoW (difficulty scaled per miner), Proof of Stake with slashing,
VRF Lottery, Proof of Knowledge, Quiz-to-Vote, Proof of Presence (rotating projector QR), Proof of Peer Vouching
and Simulated PoET. Switching is itself an on-chain transaction: the instructor key, or a coin-weighted class vote.

## Layout

| Path | What |
|---|---|
| `packages/core` | The protocol: encoding, signatures, Merkle trees, blocks, state, every consensus mode |
| `apps/node` | The node: chain, mempool, REST + WebSocket API, faucet, bots, consensus games, peer gossip |
| `apps/web` | The phone app, plus `/#/projector` for the big screen and `/#/admin` for the instructor |
| `cli-python` | The protocol in readable Python and a command-line client |
| `ops` | Docker and Cloudflare Tunnel deployment |
| `PROTOCOL.md` | Byte layouts; `test-vectors/` keeps every implementation byte-identical |

## Run it

```
npm install
npm run build                                   # builds the web app
npm run start -w @isfcr/node                    # node + app on http://localhost:8080
```

Students open the node's address on the same network. The instructor page is `/#/admin`
(set `ADMIN_TOKEN`, `FAUCET_SEED` and `INSTRUCTOR_SEED` for a real session: see `ops/.env.example`).

Headless miners and a classroom load test:

```
npm run miner -w @isfcr/node -- --name rig --stake 30
npm run loadtest -w @isfcr/node -- --clients 150
```

Tests: `npm test` (TypeScript) and `python -m unittest discover -s cli-python/tests`.
