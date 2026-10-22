import { useSyncExternalStore } from 'react'
import { type KeyPair, bytesToHex, generateKeyPair, hexToBytes, keyPairFromPrivate } from '@isfcr/core'

// Keys live only in this browser. Storage can be unavailable (private mode), so
// every access is guarded and the wallet still works for the tab's lifetime.
const KEY = 'isfcr.wallet.v1'
const TOKEN = 'isfcr.token.v1'
const NAME = 'isfcr.name.v1'

function read(k: string): string | null {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}

function write(k: string, v: string | null) {
  try {
    v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)
  } catch {
    // ignore
  }
}

interface WalletState {
  key: KeyPair | null
  token: string | null
  name: string | null
}

function load(): WalletState {
  const hex = read(KEY)
  let key: KeyPair | null = null
  try {
    key = hex ? keyPairFromPrivate(hexToBytes(hex)) : null
  } catch {
    key = null
  }
  return { key, token: read(TOKEN), name: read(NAME) }
}

let state = load()
const listeners = new Set<() => void>()
const set = (patch: Partial<WalletState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const wallet = {
  create(): KeyPair {
    const key = generateKeyPair()
    write(KEY, bytesToHex(key.privateKey))
    set({ key })
    return key
  },
  import(hex: string): KeyPair {
    const key = keyPairFromPrivate(hexToBytes(hex.trim()))
    write(KEY, bytesToHex(key.privateKey))
    set({ key })
    return key
  },
  exportHex(): string | null {
    return state.key ? bytesToHex(state.key.privateKey) : null
  },
  forget() {
    write(KEY, null)
    set({ key: null })
  },
  setName(name: string | null) {
    write(NAME, name)
    set({ name })
  },
  setToken(token: string | null) {
    write(TOKEN, token)
    set({ token })
  },
}

export const getWallet = () => state

export function subscribeWallet(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useWallet(): WalletState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
}
