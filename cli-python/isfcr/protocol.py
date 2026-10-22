"""
The ISFCRcoin protocol, written to be read. Everything here produces exactly the
same bytes as the TypeScript implementation (packages/core); tests/test_vectors.py
checks that against test-vectors/core.json. See PROTOCOL.md for the layouts.
"""
from __future__ import annotations

import hashlib
import struct

from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey

UNIT = 1_000_000  # 1 ISFCR = 1,000,000 base units; amounts are always integers
ADDRESS_PREFIX = "isfcr1"
MAX_TARGET = (1 << 256) - 1
SHARE_TARGET = MAX_TARGET // (1 << 16)  # Dynamic PoW: one share ≈ 65,536 hashes

TX_COINBASE, TX_TRANSFER, TX_STAKE, TX_UNSTAKE, TX_PROPOSE, TX_VOTE, TX_SLASH = range(7)
MODES = ["GlobalPoW", "DynamicPoW", "PoS", "VRFLottery", "PoK", "QtV", "PoP", "PoV", "PoET"]


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


# ---------------------------------------------------------------- canonical encoding

class Writer:
    """Big-endian, length-prefixed encoding. Hashes and signatures are always over these bytes."""

    def __init__(self) -> None:
        self.parts: list[bytes] = []

    def u8(self, n: int) -> "Writer":
        self.parts.append(struct.pack(">B", n)); return self

    def u32(self, n: int) -> "Writer":
        self.parts.append(struct.pack(">I", n)); return self

    def u64(self, n: int) -> "Writer":
        self.parts.append(struct.pack(">Q", n)); return self

    def fixed(self, b: bytes, length: int) -> "Writer":
        if len(b) != length:
            raise ValueError(f"expected {length} bytes, got {len(b)}")
        self.parts.append(b); return self

    def var_bytes(self, b: bytes) -> "Writer":
        return self.u32(len(b)).raw(b)

    def string(self, s: str) -> "Writer":
        return self.var_bytes(s.encode())

    def raw(self, b: bytes) -> "Writer":
        self.parts.append(b); return self

    def bytes(self) -> bytes:
        return b"".join(self.parts)


# ---------------------------------------------------------------- keys and addresses

def address_from_public_key(pub: bytes) -> str:
    """An address is the first 20 bytes of SHA-256(public key), in hex, after 'isfcr1'."""
    return ADDRESS_PREFIX + sha256(pub)[:20].hex()


def address_bytes(address: str) -> bytes:
    if not (address.startswith(ADDRESS_PREFIX) and len(address) == 46):
        raise ValueError(f"not an ISFCR address: {address}")
    return bytes.fromhex(address[len(ADDRESS_PREFIX):])


class Key:
    """An Ed25519 key pair. The 32-byte seed is the private key."""

    def __init__(self, seed: bytes) -> None:
        self.signing = SigningKey(seed)
        self.seed = seed
        self.public_key = bytes(self.signing.verify_key)
        self.address = address_from_public_key(self.public_key)

    @classmethod
    def generate(cls) -> "Key":
        return cls(bytes(SigningKey.generate()))

    def sign(self, message: bytes) -> bytes:
        return self.signing.sign(message).signature


def verify(signature: bytes, message: bytes, public_key: bytes) -> bool:
    try:
        VerifyKey(public_key).verify(message, signature)
        return True
    except (BadSignatureError, ValueError):
        return False


# ---------------------------------------------------------------- transactions

def _body(w: Writer, body: dict) -> None:
    t = body["type"]
    w.u8(t)
    if t == TX_TRANSFER:
        w.fixed(address_bytes(body["to"]), 20).u64(int(body["amount"]))
    elif t in (TX_STAKE, TX_UNSTAKE):
        w.u64(int(body["amount"]))
    elif t == TX_PROPOSE:
        w.u8(int(body["mode"])).u64(int(body["activateAt"]))
    elif t == TX_VOTE:
        w.fixed(bytes.fromhex(body["proposalId"]), 32).u8(1 if body["approve"] else 0)
    elif t == TX_SLASH:
        w.var_bytes(bytes.fromhex(body["headerA"])).var_bytes(bytes.fromhex(body["headerB"]))
    else:
        raise ValueError(f"unknown tx type {t}")


def tx_signing_bytes(tx: dict) -> bytes:
    """The exact bytes a sender signs. `tx` uses the node's JSON format (hex strings, decimal amounts)."""
    w = Writer().string("ISFCR-TX").string(tx["chainId"]).fixed(bytes.fromhex(tx["publicKey"]), 32)
    w.u64(int(tx["nonce"])).u64(int(tx["fee"]))
    _body(w, tx["body"])
    return w.bytes()


def encode_tx(tx: dict) -> bytes:
    if tx.get("type") == TX_COINBASE:
        return Writer().u8(TX_COINBASE).u64(int(tx["height"])).fixed(address_bytes(tx["to"]), 20).u64(int(tx["amount"])).bytes()
    return tx_signing_bytes(tx) + bytes.fromhex(tx["signature"])


def tx_hash(tx: dict) -> bytes:
    return sha256(encode_tx(tx))


def sign_tx(key: Key, chain_id: str, nonce: int, fee: int, body: dict) -> dict:
    """Build and sign a transaction in the node's JSON format."""
    body = {k: (str(v) if k == "amount" else v) for k, v in body.items()}
    tx = {"chainId": chain_id, "publicKey": key.public_key.hex(), "nonce": nonce, "fee": str(fee), "body": body}
    tx["signature"] = key.sign(tx_signing_bytes(tx)).hex()
    return tx


def verify_tx(tx: dict) -> bool:
    return verify(bytes.fromhex(tx["signature"]), tx_signing_bytes(tx), bytes.fromhex(tx["publicKey"]))


# ---------------------------------------------------------------- Merkle tree and blocks

def merkle_root(leaves: list[bytes]) -> bytes:
    """Pair hashes level by level; an odd one out is paired with itself. No leaves: 32 zero bytes."""
    if not leaves:
        return bytes(32)
    level = leaves
    while len(level) > 1:
        level = [sha256(level[i] + (level[i + 1] if i + 1 < len(level) else level[i])) for i in range(0, len(level), 2)]
    return level[0]


def header_prefix(h: dict) -> bytes:
    """Header bytes up to (not including) the nonce, so a miner serialises once and appends nonces."""
    return (Writer()
            .u8(int(h["version"]))
            .u64(int(h["height"]))
            .fixed(bytes.fromhex(h["prevHash"]), 32)
            .fixed(bytes.fromhex(h["merkleRoot"]), 32)
            .u64(int(h["timestamp"]))
            .u8(int(h["mode"]))
            .fixed(address_bytes(h["proposer"]), 20)
            .fixed(int(h["target"] or "0", 16).to_bytes(32, "big"), 32)
            .var_bytes(bytes.fromhex(h.get("proof") or ""))
            .bytes())


def encode_header(h: dict) -> bytes:
    return header_prefix(h) + struct.pack(">Q", int(h["nonce"]))


def header_hash(h: dict) -> bytes:
    return sha256(encode_header(h))


def meets_target(hash_: bytes, target: int) -> bool:
    return int.from_bytes(hash_, "big") <= target


# ---------------------------------------------------------------- host-run games

def action_bytes(chain_id: str, height: int, action: str, body: dict) -> bytes:
    """What a player signs for a game action. The body is JSON exactly as the browser sends it."""
    import json
    return (Writer().string("ISFCR-ACT").string(chain_id).u64(height).string(action)
            .string(json.dumps(body, separators=(",", ":"), ensure_ascii=False)).bytes())
