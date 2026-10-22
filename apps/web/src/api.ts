import { type SignedTx, txToJSON } from '@isfcr/core'

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`)
  return body as T
}

const post = <T>(path: string, body: unknown, headers?: Record<string, string>) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), headers })

export interface Info {
  chainId: string
  genesisHash: string
  height: number
  tip: string
  mode: number
  modeName: string
  /** Consensus mode the next block must use (differs from `mode` at the switch height). */
  nextMode: number
  target: string
  difficulty: number
  nextReward: string
  emitted: string
  scheduledSwitch: { mode: number; activateAt: number } | null
  mempoolSize: number
  implementedModes: number[]
  oldRules: boolean
  openJoin: boolean
  clients: number
  params: { targetBlockMs: number; maxTxsPerBlock: number; minFee: string; halvingInterval: number; shareTarget: string; shareWork: number }
}

export interface BlockSummary {
  hash: string
  height: number
  prevHash: string
  timestamp: number
  mode: number
  proposer: string
  txCount: number
  coinbase: string
}

export interface AccountView {
  address: string
  balance: string
  stake: string
  nonce: number
  nextNonce: number
}

export interface PosStatus {
  active: boolean
  height: number
  round: number
  leader: string | null
  opensAt: number
  nextRoundAt: number
  totalStake: string
  stakers: { address: string; stake: string; chance: number }[]
  attestations: number
}

export interface Proposal {
  id: string
  proposer: string
  byInstructor: boolean
  mode: number
  modeName: string
  activateAt: number
  passed: boolean
  open: boolean
  votesFor: string[]
  votesAgainst: string[]
  support: string
  against: string
  circulating: string
}

export interface LotteryStatus {
  active: boolean
  height: number
  opensAt: number
  entries: number
  best: { address: string; value: string } | null
  ranking: { address: string; value: string }[]
}

/** Host-run game round (PoK, QtV, PoP, PoV, PoET). Mode-specific fields are optional. */
export interface RoundStatus {
  active: boolean
  mode?: number
  modeName?: string
  height?: number
  opensAt?: number
  startedAt?: number
  winner?: string | null
  cert?: string | null
  // PoET
  entrants?: number
  myWaitMs?: number | null
  shortest?: { address: string; waitMs: number; at: number } | null
  // PoP
  present?: number
  checkedIn?: boolean
  // PoK / QtV
  question?: string
  choices?: string[]
  commitment?: string
  locked?: boolean
  answers?: number
  answer?: number | null
  salt?: string | null
  correct?: number | null
  candidates?: string[] | Record<string, number>
  voted?: boolean
  standing?: boolean
  ballots?: number
  tally?: Record<string, number> | null
  // PoV
  myTrust?: number
  vouchedFor?: string | null
  topTrust?: [string, number][]
}

export interface MempoolEntry {
  id: string
  sender: string
  receivedAt: number
  tx: any
}

export const api = {
  info: () => request<Info>('/api/info'),
  chain: (limit = 30) => request<BlockSummary[]>(`/api/chain?limit=${limit}`),
  block: (id: string | number) => request<any>(`/api/block/${id}`),
  account: (addr: string) => request<AccountView>(`/api/state/${addr}`),
  mempool: (limit = 200) => request<{ size: number; txs: MempoolEntry[] }>(`/api/mempool?limit=${limit}`),
  leaderboard: () => request<{ address: string; blocks: number; rewards: string }[]>('/api/leaderboard'),
  template: (proposer: string, txIds?: string[]) =>
    request<{ block: any; reward: string; fees: string }>(
      `/api/template?proposer=${proposer}${txIds ? `&txs=${txIds.join(',')}` : ''}`),
  submitTx: (tx: SignedTx) => post<{ id: string }>('/api/tx', txToJSON(tx)),
  submitBlock: (block: any) => post<{ status: string; hash: string; height: number }>('/api/block', block),
  join: (code: string, name?: string) => post<{ token: string }>('/api/join', { code, name }),
  names: () => request<Record<string, string>>('/api/names'),
  submitShares: (header: any, nonces: string[]) => post<{ accepted: number; hashrate: number }>('/api/shares', { header, nonces }),
  difficulty: () => request<{ mode: number; activeMiners: number; miners: { address: string; hashrate: number; work: number }[] }>('/api/difficulty'),
  pos: () => request<PosStatus>('/api/pos'),
  proposals: () => request<Proposal[]>('/api/proposals'),
  lottery: () => request<LotteryStatus>('/api/lottery'),
  round: (who?: string) => request<RoundStatus>(`/api/round${who ? `?who=${who}` : ''}`),
  act: (action: string, body: Record<string, unknown>, publicKey: string, signature: string) =>
    post<any>('/api/round/act', { action, body, publicKey, signature }),
  enterLottery: (publicKey: string, ticket: string) => post<{ rank: number; entries: number }>('/api/lottery/enter', { publicKey, ticket }),
  attest: (blockHash: string, publicKey: string, signature: string) => post<{ attestations: number }>('/api/attest', { blockHash, publicKey, signature }),
  admin: (token: string, path: string, body: unknown = {}) => post<any>(`/api/admin/${path}`, body, { authorization: `Bearer ${token}` }),
  adminGet: <T>(token: string, path: string) => request<T>(`/api/admin/${path}`, { headers: { authorization: `Bearer ${token}` } }),
  faucet: (token: string, address: string) => post<{ txid: string; amount: string }>('/api/faucet', { token, address }),
}
