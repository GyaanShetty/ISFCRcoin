"""
ISFCRcoin from the command line, in plain Python.

  python -m isfcr join NAME            create a key, join the session, claim the faucet
  python -m isfcr balance              your balance, stake and nonce
  python -m isfcr send ADDRESS AMOUNT  sign and send coins (--fee 0.1)
  python -m isfcr mine                 mine with hashlib (Global or Dynamic PoW)
  python -m isfcr block HEIGHT         fetch a block and check its hashes yourself
  python -m isfcr verify FILE.json     check a transaction's signature

Use --url to point at the node (default http://localhost:8080). Your key and session
are kept in .isfcr.json in the current folder.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import random
import struct
import sys
import time
import urllib.error
import urllib.request

from . import protocol as p

STATE = pathlib.Path(".isfcr.json")


class Node:
    def __init__(self, url: str) -> None:
        self.url = url.rstrip("/")

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, method=method, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            msg = json.loads(e.read() or b"{}").get("error", str(e))
            raise SystemExit(f"node said: {msg}")
        except urllib.error.URLError as e:
            raise SystemExit(f"can't reach {self.url}: {e.reason}")

    def get(self, path: str) -> dict:
        return self._call("GET", path)

    def post(self, path: str, body: dict) -> dict:
        return self._call("POST", path, body)


def load_state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save_state(state: dict) -> None:
    STATE.write_text(json.dumps(state, indent=2))
    STATE.chmod(0o600)


def my_key() -> p.Key:
    state = load_state()
    if "seed" not in state:
        raise SystemExit("no key yet: run  python -m isfcr join YOURNAME")
    return p.Key(bytes.fromhex(state["seed"]))


def coins(units: int) -> str:
    whole, frac = divmod(int(units), p.UNIT)
    return f"{whole}.{frac:06d}".rstrip("0").rstrip(".") + " ISFCR"


def parse_coins(s: str) -> int:
    whole, _, frac = s.partition(".")
    return int(whole or 0) * p.UNIT + int((frac + "000000")[:6] or 0)


# ---------------------------------------------------------------- commands

def cmd_join(node: Node, args) -> None:
    state = load_state()
    key = p.Key(bytes.fromhex(state["seed"])) if "seed" in state else p.Key.generate()
    token = node.post("/api/join", {"code": args.code or args.name, "name": args.name})["token"]
    state.update(seed=key.seed.hex(), token=token, name=args.name, url=node.url)
    save_state(state)
    print(f"you are {args.name}: {key.address}")
    try:
        r = node.post("/api/faucet", {"token": token, "address": key.address})
        print(f"faucet: {r['amount']} ISFCR on the way, it arrives with the next block")
    except SystemExit as e:
        print(e)


def cmd_balance(node: Node, args) -> None:
    key = my_key()
    a = node.get(f"/api/state/{key.address}")
    print(f"address  {key.address}")
    print(f"balance  {coins(a['balance'])}")
    print(f"staked   {coins(a['stake'])}")
    print(f"nonce    {a['nonce']}" + (f" ({a['nextNonce'] - a['nonce']} pending)" if a["nextNonce"] > a["nonce"] else ""))


def cmd_send(node: Node, args) -> None:
    key = my_key()
    info = node.get("/api/info")
    nonce = node.get(f"/api/state/{key.address}")["nextNonce"]
    tx = p.sign_tx(key, info["chainId"], nonce, parse_coins(args.fee), {"type": p.TX_TRANSFER, "to": args.to, "amount": parse_coins(args.amount)})
    print("signed bytes:", p.tx_signing_bytes(tx).hex())
    print("signature:   ", tx["signature"])
    r = node.post("/api/tx", tx)
    print(f"sent, tx id {r['id']}. It goes through with the next block.")


def cmd_mine(node: Node, args) -> None:
    key = my_key()
    found = 0
    print(f"mining to {key.address}")
    while found < args.count:
        info = node.get("/api/info")
        if info["nextMode"] not in (0, 1):
            print(f"the class is in {p.MODES[info['nextMode']]} mode: nothing to hash. Waiting…")
            time.sleep(5)
            continue
        tpl = node.get(f"/api/template?proposer={key.address}")["block"]
        header = tpl["header"]
        dynamic = header["mode"] == 1
        target = int(header["target"], 16)
        prefix = p.header_prefix(header)
        nonce = start = random.getrandbits(40)
        shares: list[int] = []
        started = time.time()
        while True:
            # The hot loop: hash the fixed prefix plus 8 nonce bytes, compare against the target.
            for _ in range(50_000):
                h = p.sha256(prefix + struct.pack(">Q", nonce))
                v = int.from_bytes(h, "big")
                if v <= target:
                    break
                if dynamic and v <= p.SHARE_TARGET:
                    shares.append(nonce)
                nonce += 1
            else:
                if shares:
                    node.post("/api/shares", {"header": header, "nonces": [str(n) for n in shares]})
                    shares.clear()
                if node.get("/api/info")["tip"] != header["prevHash"] or (dynamic and time.time() - started > 20):
                    break  # someone else won, or time for a fresh difficulty ticket
                continue
            header["nonce"] = str(nonce)
            r = node.post("/api/block", tpl)
            rate = int((nonce - start + 1) / max(time.time() - started, 0.001))
            print(f"block {header['height']}: {r.get('status')}  (~{rate:,} hashes/s, hash {h.hex()[:16]}…)")
            found += 1
            break


def cmd_block(node: Node, args) -> None:
    b = node.get(f"/api/block/{args.height}")
    h = b["header"]
    root = p.merkle_root([p.tx_hash(t) for t in b["txs"]]).hex()
    hsh = p.header_hash(h).hex()
    print(f"block {h['height']} ({p.MODES[h['mode']]}) by {h['proposer']}")
    print(f"  prevHash    {h['prevHash']}")
    print(f"  merkleRoot  {h['merkleRoot']}  {'ok' if root == h['merkleRoot'] else 'MISMATCH, recomputed ' + root}")
    print(f"  hash        {b['hash']}  {'ok' if hsh == b['hash'] else 'MISMATCH, recomputed ' + hsh}")
    if h["mode"] in (0, 1):
        print(f"  proof of work  {'ok' if p.meets_target(bytes.fromhex(hsh), int(h['target'], 16)) else 'FAILS'}")
    for t in b["txs"][1:]:
        sender = p.address_from_public_key(bytes.fromhex(t["publicKey"]))
        print(f"  tx {p.tx_hash(t).hex()[:12]}…  from {sender[:14]}…  signature {'ok' if p.verify_tx(t) else 'BAD'}")


def cmd_verify(_node: Node, args) -> None:
    tx = json.loads(pathlib.Path(args.file).read_text())
    sender = p.address_from_public_key(bytes.fromhex(tx["publicKey"]))
    print(f"signed by {sender}: {'valid' if p.verify_tx(tx) else 'INVALID'}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="isfcr", description="ISFCRcoin command-line client")
    ap.add_argument("--url", default=None, help="node URL (default: the one you joined, or http://localhost:8080)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    j = sub.add_parser("join", help="create a key, join, and claim the faucet")
    j.add_argument("name")
    j.add_argument("--code", help="join code from the instructor (if open join is off)")
    sub.add_parser("balance", help="show your balance")
    s = sub.add_parser("send", help="send coins")
    s.add_argument("to")
    s.add_argument("amount")
    s.add_argument("--fee", default="0.1")
    m = sub.add_parser("mine", help="mine blocks")
    m.add_argument("--count", type=int, default=sys.maxsize)
    b = sub.add_parser("block", help="fetch a block and verify it yourself")
    b.add_argument("height")
    v = sub.add_parser("verify", help="check a transaction's signature")
    v.add_argument("file")
    args = ap.parse_args(argv)
    node = Node(args.url or load_state().get("url") or "http://localhost:8080")
    {"join": cmd_join, "balance": cmd_balance, "send": cmd_send, "mine": cmd_mine, "block": cmd_block, "verify": cmd_verify}[args.cmd](node, args)


if __name__ == "__main__":
    main()
