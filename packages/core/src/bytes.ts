import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from '@noble/hashes/utils'

export { bytesToHex, hexToBytes, utf8ToBytes, concatBytes }

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export function bytesToBigInt(b: Uint8Array): bigint {
  return b.length === 0 ? 0n : BigInt('0x' + bytesToHex(b))
}

export function bigIntToBytes32(n: bigint): Uint8Array {
  if (n < 0n || n >= 1n << 256n) throw new Error('out of range for 32 bytes')
  return hexToBytes(n.toString(16).padStart(64, '0'))
}

/**
 * Canonical binary writer. Every hashed or signed structure is serialised with
 * this, field by field in a fixed order; see PROTOCOL.md for the layouts.
 */
export class Writer {
  private chunks: Uint8Array[] = []

  u8(n: number): this {
    this.chunks.push(Uint8Array.of(n & 0xff))
    return this
  }

  u32(n: number): this {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, n, false)
    this.chunks.push(b)
    return this
  }

  u64(n: bigint | number): this {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setBigUint64(0, BigInt(n), false)
    this.chunks.push(b)
    return this
  }

  fixed(b: Uint8Array, len: number): this {
    if (b.length !== len) throw new Error(`expected ${len} bytes, got ${b.length}`)
    this.chunks.push(b)
    return this
  }

  varBytes(b: Uint8Array): this {
    return this.u32(b.length).raw(b)
  }

  str(s: string): this {
    return this.varBytes(utf8ToBytes(s))
  }

  raw(b: Uint8Array): this {
    this.chunks.push(b)
    return this
  }

  bytes(): Uint8Array {
    return concatBytes(...this.chunks)
  }
}

/** Reads the canonical encoding written by Writer. Throws on truncated input. */
export class Reader {
  private off = 0
  constructor(private buf: Uint8Array) {}

  private take(n: number): Uint8Array {
    if (this.off + n > this.buf.length) throw new Error('unexpected end of data')
    const out = this.buf.slice(this.off, this.off + n)
    this.off += n
    return out
  }

  u8(): number {
    return this.take(1)[0]
  }

  u32(): number {
    return new DataView(this.take(4).buffer).getUint32(0, false)
  }

  u64(): bigint {
    return new DataView(this.take(8).buffer).getBigUint64(0, false)
  }

  fixed(n: number): Uint8Array {
    return this.take(n)
  }

  varBytes(): Uint8Array {
    return this.take(this.u32())
  }

  get done(): boolean {
    return this.off === this.buf.length
  }
}
