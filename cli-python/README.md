# ISFCRcoin in Python

The ISFCRcoin protocol written out in plain, readable Python, plus a command-line client that
talks to the class node. It produces exactly the same bytes as the browser app: the tests check it
against the shared vectors in `../test-vectors/core.json`.

```
pip install -r requirements.txt
python -m isfcr --url http://<node-address>:8080 join yourname
python -m isfcr mine
python -m isfcr balance
python -m isfcr send isfcr1… 2.5
python -m isfcr block 12        # fetch a block and check every hash and signature yourself
```

Read `isfcr/protocol.py` alongside `../PROTOCOL.md`: transactions, signatures, the Merkle tree and
block headers are each a few lines. `isfcr/cli.py` shows how a miner uses them: the mining loop is
`sha256(header_prefix + nonce)` compared against the target.

Run the tests with `python -m unittest discover -s tests`.
