"""Bounded resumable CipherScan capture and operator-controlled historical RPC replay.

The header hash is checked independently; transaction IDs and decoded fields share
one provider. This is captured historical data, not consensus/full-node proof.
"""
import argparse
import datetime
import email.utils
import gzip
import json
import pathlib
import re
import struct
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if __package__:
    from .modern_capture import API, exact_json, header, parse_json, sha
else:
    from modern_capture import API, exact_json, header, parse_json, sha

MAX_BYTES = 512 * 1024**2
MAX_BODY = 16 * 1024**2
LIMITATIONS = [
    "Historical contiguous mainnet NU5 capture, not modern-tip or live-node evidence.",
    "Raw block reconstructed from CipherScan header fields and transaction hex.",
    "Double-SHA256 header hash and predecessor links checked against captured listings.",
    "Transaction hex, transaction IDs, and decoder metadata share one provider; no independent v5 transaction-id or consensus validation.",
    "RPC replay envelope and controllable head are synthesized for bounded experiments.",
]


def require(ok, message):
    if not ok:
        raise ValueError(message)


def compact(value):
    require(0 <= value <= 0xffffffffffffffff, "CompactSize range")
    if value < 253:
        return bytes([value])
    size, prefix = (2, 253) if value <= 65535 else (4, 254) if value <= 0xffffffff else (8, 255)
    return bytes([prefix]) + value.to_bytes(size, "little")


def hash_hex(value):
    require(isinstance(value, str) and re.fullmatch("[0-9a-f]{64}", value), "invalid hash")
    return bytes.fromhex(value)


def reconstruct_header(listing):
    fields = struct.pack("<I", int(listing["version"]))
    for key in ["previous_block_hash", "merkle_root", "final_sapling_root"]:
        fields += hash_hex(listing[key])[::-1]
    fields += struct.pack("<I", int(listing["timestamp"]))
    bits = bytes.fromhex(listing["bits"])
    require(len(bits) == 4, "invalid bits")
    fields += bits[::-1] + hash_hex(listing["nonce"])[::-1]
    solution = bytes.fromhex(listing["solution"])
    fields += compact(len(solution)) + solution
    require(sha256d(fields) == listing["hash"], "reconstructed header hash mismatch")
    return fields


def sha256d(raw):
    import hashlib
    return hashlib.sha256(hashlib.sha256(raw).digest()).digest()[::-1].hex()


class Store:
    """One process owns the cache; every network request is sequential and paced."""
    def __init__(self, root, seconds=1800):
        self.root, self.deadline = root, time.monotonic() + seconds
        self.last_request = 0
        self.bytes = sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
        require(self.bytes <= MAX_BYTES, "existing capture exceeds byte budget")

    def check(self):
        require(time.monotonic() < self.deadline, "capture deadline exhausted; partial cache retained")

    def write(self, path, raw):
        self.check()
        old = path.stat().st_size if path.exists() else 0
        # Account for the temporary atomic-write copy as well.
        require(self.bytes + len(raw) <= MAX_BYTES, "capture byte budget exhausted; partial cache retained")
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + ".tmp")
        temp.write_bytes(raw)
        temp.replace(path)
        self.bytes += len(raw) - old

    def fetch(self, relative, route):
        path = self.root / "responses" / relative
        meta = path.with_suffix(path.suffix + ".meta.json")
        if path.exists() and meta.exists():
            raw = path.read_bytes()
            source = json.loads(meta.read_text())
            require(sha(raw) == source["sha256"] and len(raw) == source["bytes"], "cached response checksum mismatch")
            require(source["requested_url"] == API + route, "cached source URL mismatch")
            return parse_json(raw), source
        for attempt in range(5):
            self.check()
            wait = max(0, self.last_request + 0.7 - time.monotonic())
            require(time.monotonic() + wait < self.deadline, "capture deadline exhausted")
            time.sleep(wait)
            self.last_request = time.monotonic()
            url = API + route
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "Zeer-bounded-modern-capture/1.0"})
                with urllib.request.urlopen(request, timeout=min(30, max(1, self.deadline - time.monotonic()))) as response:
                    require(response.url.startswith(API + "/"), "unexpected redirect outside capture provider")
                    raw = response.read(min(MAX_BODY, MAX_BYTES - self.bytes) + 1)
                    require(len(raw) <= MAX_BODY and self.bytes + len(raw) <= MAX_BYTES, "response byte budget exceeded")
                    parse_json(raw)
                    source = {"requested_url": url, "resolved_url": response.url, "sha256": sha(raw), "bytes": len(raw),
                              "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
                    self.write(path, raw)
                    self.write(meta, exact_json(source).encode())
                    return parse_json(raw), source
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                    raise
                retry = error.headers.get("Retry-After")
                delay = 2 ** attempt
                if retry:
                    try:
                        delay = max(delay, float(retry))
                    except ValueError:
                        delay = max(delay, email.utils.parsedate_to_datetime(retry).timestamp() - time.time())
                require(delay <= 120 and time.monotonic() + delay < self.deadline, "retry exceeds bounded capture deadline")
                time.sleep(max(0, delay))
        raise RuntimeError("unreachable retry state")


def build_block(listing, items, height):
    require(int(listing["height"]) == height, "listing height mismatch")
    summaries = listing["transactions"]
    require(int(listing["transaction_count"]) == len(summaries) == len(items) > 0, "transaction count mismatch")
    txs, payloads, seen = [], [], set()
    for index, (summary, item) in enumerate(zip(summaries, items)):
        txid = summary["txid"]
        hash_hex(txid)
        require(txid not in seen, "duplicate transaction")
        seen.add(txid)
        require(int(summary["tx_index"]) == index and int(summary["block_height"]) == height, "listing transaction order mismatch")
        require(summary["block_hash"] == listing["hash"], "listing transaction block mismatch")
        tx = item["decoded"]
        require(tx["txid"] == item["txid"] == txid, "transaction identity mismatch")
        require(tx["hex"] == item["hex"] and tx["blockhash"] == listing["hash"], "transaction payload/block mismatch")
        payload = bytes.fromhex(tx["hex"])
        require(len(payload) > 0, "empty transaction")
        if "size" in tx:
            require(int(tx["size"]) == len(payload), "decoded transaction size mismatch")
        txs.append(tx)
        payloads.append(payload)
    raw = reconstruct_header(listing) + compact(len(txs)) + b"".join(payloads)
    decoded, _ = header(raw, height)
    decoded["tx"] = txs
    return {"raw": raw.hex(), "raw_sha256": sha(raw), "decoded": decoded}


def totals(blocks):
    result = dict.fromkeys(["transactions", "sapling_transactions", "orchard_transactions", "sapling_spends", "sapling_outputs", "orchard_actions"], 0)
    for block in blocks:
        for tx in block["decoded"]["tx"]:
            spends, outputs = len(tx.get("vShieldedSpend", [])), len(tx.get("vShieldedOutput", []))
            actions = len(tx.get("orchard", {}).get("actions", []))
            for key, value in zip(result, [1, bool(spends or outputs), bool(actions), spends, outputs, actions]):
                result[key] += value
    return result


def oracle(blocks):
    headers, transactions = [], []
    for block in blocks:
        decoded = block["decoded"]
        headers.append({"id": str(decoded["height"]), "hash": decoded["hash"], "time": str(decoded["time"]), "transactionCount": len(decoded["tx"])})
        for tx in decoded["tx"]:
            transactions.append({"id": tx["txid"], "minedHeight": decoded["height"], "version": tx["version"],
                                 "locktime": str(tx["locktime"]), "sizeBytes": len(bytes.fromhex(tx["hex"])),
                                 "transparentInputCount": len(tx["vin"]), "transparentOutputCount": len(tx["vout"])})
    return {"range": {"from": blocks[0]["decoded"]["height"], "to": blocks[-1]["decoded"]["height"]},
            "source": "CipherScan captured decoder; independent of Prep/Chef; same-provider raw and decoded data", "blocks": headers, "transactions": transactions}


def capture(directory, start, count, seconds=1800):
    require(2 <= count <= 1024 and start >= 1687104, "capture requires 2..1024 NU5 blocks")
    directory.mkdir(parents=True, exist_ok=True)
    lock = directory / ".capture.lock"
    # Exclusive ownership prevents concurrent capture processes bypassing pacing.
    with lock.open("x") as owner:
        owner.write(str(__import__("os").getpid()))
    try:
        store = Store(directory, seconds)
        config = directory / "capture.json"
        expected = {"from_block": start, "blocks": count, "api": API, "schema_version": 1}
        if config.exists():
            require(json.loads(config.read_text()) == expected, "resume configuration mismatch")
        else:
            store.write(config, exact_json(expected).encode())
        blocks, sources, observations = [], [], []
        for height in range(start, start + count):
            listing, source = store.fetch(f"blocks/{height}.json", f"/block/{height}")
            sources.append(source)
            items = []
            for summary in listing["transactions"]:
                txid = summary["txid"]
                hash_hex(txid)
                item, source = store.fetch(f"transactions/{txid}.json", f"/tx/{txid}/verbose")
                items.append(item)
                sources.append(source)
            block = build_block(listing, items, height)
            if blocks:
                require(block["decoded"]["previousblockhash"] == blocks[-1]["decoded"]["hash"], "contiguous header link mismatch")
            if int(listing["size"]) != len(bytes.fromhex(block["raw"])):
                observations.append({"height": height, "explorer_reported_size": int(listing["size"]), "reconstructed_raw_size": len(bytes.fromhex(block["raw"]))})
            store.write(directory / "blocks" / f"{height}.json", exact_json(block).encode())
            blocks.append(block)
            store.write(directory / "progress.json", exact_json({"status": "partial", "validated_blocks": len(blocks), "height": height}).encode())
            print(json.dumps({"status": "BLOCK_VALIDATED", "height": height, "transactions": len(block["decoded"]["tx"]), "cached_bytes": store.bytes}), flush=True)
        fixture = {"schema_version": 1, "source_kind": "captured-reconstructed-mainnet-historical-replay",
                   "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "blocks": blocks,
                   "sources": sources, "observations": observations, "limitations": LIMITATIONS, "totals": totals(blocks)}
        store.write(directory / "fixture.json", exact_json(fixture).encode())
        store.write(directory / "oracle.json.gz", gzip.compress(exact_json(oracle(blocks)).encode(), mtime=0))
        store.write(directory / "progress.json", exact_json({"status": "complete", "validated_blocks": count, "height": start + count - 1}).encode())
        print(json.dumps({"status": "PASS", "blocks": count, **fixture["totals"]}), flush=True)
    finally:
        lock.unlink()


def replay_result(directory, control, method, params, hash_heights=None):
    state = json.loads(control.read_text())
    require(state.get("online") is True, "operator replay source offline")
    height = state["height"]
    require(type(height) is int, "invalid published head")
    config = json.loads((directory / "capture.json").read_text())
    start, end = config["from_block"], config["from_block"] + config["blocks"] - 1
    require(start <= height <= end, "published head outside capture")

    def load(number):
        require(start <= number <= height, "block beyond published head")
        return parse_json((directory / "blocks" / f"{number}.json").read_bytes())

    if method == "getblockchaininfo" and not params:
        return {"chain": "main", "blocks": height, "bestblockhash": load(height)["decoded"]["hash"]}
    if method == "getblockhash" and len(params) == 1 and type(params[0]) is int:
        return load(start)["decoded"]["previousblockhash"] if params[0] == start - 1 else load(params[0])["decoded"]["hash"]
    if method == "getblock" and len(params) == 2 and type(params[1]) is int and params[1] in (0, 1, 2):
        if hash_heights is None:
            hash_heights = {load(number)["decoded"]["hash"]: number for number in range(start, height + 1)}
        number = hash_heights.get(params[0])
        if number is not None:
            block = load(number)
            if block["decoded"]["hash"] == params[0]:
                if params[1] == 0:
                    return block["raw"]
                result = block["decoded"]
                return {**result, "tx": [tx["txid"] for tx in result["tx"]]} if params[1] == 1 else result
    raise ValueError("method or block outside bounded replay")


def serve(directory, control, bind, port):
    require(bind == "127.0.0.1", "replay binds IPv4 loopback only")
    # Build once, including only validated captured blocks. Each RPC then opens
    # only its requested block, while load() still enforces the current head.
    hash_heights = {}
    for path in sorted((directory / "blocks").glob("*.json")):
        decoded = parse_json(path.read_bytes())["decoded"]
        hash_heights[decoded["hash"]] = decoded["height"]
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            request = {}
            try:
                online = json.loads(control.read_text()).get("online") is True
            except (ValueError, OSError):
                online = False
            if not online:
                self.send_error(503, "operator replay source offline")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                require(0 < length <= 65536, "request size limit")
                request = json.loads(self.rfile.read(length))
                require(isinstance(request, dict), "JSON object required")
                result = replay_result(directory, control, request.get("method"), request.get("params", []), hash_heights)
                response = {"jsonrpc": "2.0", "id": request.get("id"), "result": result}
            except (ValueError, TypeError, KeyError, OSError):
                response = {"jsonrpc": "2.0", "id": request.get("id") if isinstance(request, dict) else None,
                            "error": {"code": -32602, "message": "bounded historical replay unavailable"}}
            raw = exact_json(response).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        def log_message(self, *args):
            pass
    print(f"Historical replay http://{bind}:{port}; operator head {control}; NOT a live node", flush=True)
    ThreadingHTTPServer((bind, port), Handler).serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("capture")
    command.add_argument("--out", type=pathlib.Path, required=True)
    command.add_argument("--from-block", type=int, default=1687106)
    command.add_argument("--blocks", type=int, default=256)
    command.add_argument("--deadline-seconds", type=int, default=1800)
    command = commands.add_parser("serve")
    command.add_argument("--directory", type=pathlib.Path, required=True)
    command.add_argument("--control", type=pathlib.Path, required=True)
    command.add_argument("--bind", default="127.0.0.1")
    command.add_argument("--port", type=int, default=18232)
    args = parser.parse_args()
    if args.command == "capture":
        require(1 <= args.deadline_seconds <= 1800, "deadline must be 1..1800 seconds")
        capture(args.out, args.from_block, args.blocks, args.deadline_seconds)
    else:
        serve(args.directory, args.control, args.bind, args.port)
