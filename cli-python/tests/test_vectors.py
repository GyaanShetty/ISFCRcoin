"""Checks the Python protocol against the golden vectors produced by the TypeScript core."""
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from isfcr import protocol as p  # noqa: E402

VECTORS = json.loads((pathlib.Path(__file__).resolve().parents[2] / "test-vectors" / "core.json").read_text())


class Vectors(unittest.TestCase):
    def test_key_and_address(self):
        k = p.Key(bytes.fromhex(VECTORS["keys"]["faucetSeed"]))
        self.assertEqual(k.public_key.hex(), VECTORS["keys"]["faucetPublicKey"])
        self.assertEqual(k.address, VECTORS["keys"]["faucetAddress"])

    def test_transaction_bytes_and_hash(self):
        tx = VECTORS["tx"]["json"]
        self.assertEqual(p.tx_signing_bytes(tx).hex(), VECTORS["tx"]["signingBytes"])
        self.assertEqual(p.encode_tx(tx).hex(), VECTORS["tx"]["encoded"])
        self.assertEqual(p.tx_hash(tx).hex(), VECTORS["tx"]["hash"])
        self.assertTrue(p.verify_tx(tx))

    def test_signing_reproduces_the_same_signature(self):
        # Ed25519 is deterministic: re-signing with the same key gives the same signature.
        tx = VECTORS["tx"]["json"]
        k = p.Key(bytes.fromhex(VECTORS["keys"]["faucetSeed"]))
        again = p.sign_tx(k, tx["chainId"], tx["nonce"], int(tx["fee"]), tx["body"])
        self.assertEqual(again["signature"], tx["signature"])

    def test_tampering_breaks_the_signature(self):
        tx = json.loads(json.dumps(VECTORS["tx"]["json"]))
        tx["body"]["amount"] = str(int(tx["body"]["amount"]) + 1)
        self.assertFalse(p.verify_tx(tx))

    def test_block(self):
        block = VECTORS["block"]["json"]
        leaves = [p.tx_hash(t) for t in block["txs"]]
        self.assertEqual(p.merkle_root(leaves).hex(), VECTORS["block"]["merkleRoot"])
        self.assertEqual(p.encode_header(block["header"]).hex(), VECTORS["block"]["headerBytes"])
        self.assertEqual(p.header_hash(block["header"]).hex(), VECTORS["block"]["hash"])
        self.assertTrue(p.meets_target(bytes.fromhex(VECTORS["block"]["hash"]), int(block["header"]["target"], 16)))


if __name__ == "__main__":
    unittest.main()
