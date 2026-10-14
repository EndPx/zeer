"""Capture a bounded ordered public oracle from a private, pinned mainnet node.

Read-only RPC; checks node-reported identities and bytes, not Zcash consensus/SPV.
New output is atomically published only after complete capture and pin validation.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time

from benchmarks.prep.full.reorg_proof import PrivateEndpoint
from benchmarks.prep.scale.run import require, sha

GENESIS = '00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08'
MAX_ROWS = 500_000


def uint(value, code):
    require(type(value) is int and 0 <= value <= 0xffffffff, code)
    return value


def hexhash(value):
    require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value), 'INVALID_HASH')
    return value


def pin(source, expected_head, expected_hash):
    info = source.rpc('getblockchaininfo', [])
    require(info.get('chain') in ['main', 'mainnet'], 'MAINNET_REQUIRED')
    require(uint(info.get('blocks'), 'INVALID_SOURCE_HEIGHT') == expected_head
        and hexhash(info.get('bestblockhash')) == expected_hash, 'SOURCE_PIN_CHANGED')
    require(source.rpc('getblockhash', [expected_head]) == expected_hash, 'SOURCE_HEAD_HASH_CHANGED')
    require(source.rpc('getblockhash', [0]) == GENESIS, 'MAINNET_GENESIS_REQUIRED')
    return {'height': expected_head, 'hash': expected_hash}


def project_block(block, height, blockhash, parent):
    require(isinstance(block, dict) and uint(block.get('height'), 'INVALID_BLOCK_HEIGHT') == height
        and hexhash(block.get('hash')) == blockhash and hexhash(block.get('previousblockhash')) == parent, 'BLOCK_IDENTITY_OR_LINK')
    timestamp = uint(block.get('time'), 'INVALID_BLOCK_TIME')
    transactions = block.get('tx')
    require(isinstance(transactions, list) and transactions, 'COMPLETE_TRANSACTION_ARRAY_REQUIRED')
    rows = []
    seen = set()
    for tx in transactions:
        require(isinstance(tx, dict), 'DECODED_TRANSACTION_REQUIRED')
        txid = hexhash(tx.get('txid'))
        require(txid not in seen, 'DUPLICATE_TRANSACTION_IN_BLOCK'); seen.add(txid)
        raw = tx.get('hex')
        require(isinstance(raw, str) and raw and len(raw) % 2 == 0
            and re.fullmatch(r'[0-9a-fA-F]+', raw), 'INVALID_TRANSACTION_RAW_HEX')
        size = len(raw) // 2
        uint(size, 'INVALID_TRANSACTION_SIZE')
        if 'size' in tx: require(uint(tx['size'], 'INVALID_DECLARED_SIZE') == size, 'TRANSACTION_SIZE_MISMATCH')
        vin, vout = tx.get('vin'), tx.get('vout')
        require(isinstance(vin, list) and isinstance(vout, list)
            and all(isinstance(row, dict) for row in vin) and all(isinstance(row, dict) for row in vout), 'PUBLIC_INPUT_OUTPUT_ARRAYS_REQUIRED')
        rows.append({'id': txid, 'minedHeight': height, 'version': uint(tx.get('version'), 'INVALID_VERSION'),
            'locktime': str(uint(tx.get('locktime'), 'INVALID_LOCKTIME')), 'sizeBytes': size,
            'transparentInputCount': uint(len(vin), 'INPUT_COUNT_LIMIT'),
            'transparentOutputCount': uint(len(vout), 'OUTPUT_COUNT_LIMIT')})
    return {'id': str(height), 'hash': blockhash, 'time': str(timestamp), 'transactionCount': len(rows)}, rows


def write_array(target, spool):
    target.write(b'[')
    with spool.open('rb') as stream:
        first = True
        for line in stream:
            if not first: target.write(b',')
            target.write(line.rstrip(b'\n')); first = False
    target.write(b']')


def capture(source, expected_head, expected_hash, end, out):
    require(1 <= uint(end, 'INVALID_END_HEIGHT') <= 32768 and end <= uint(expected_head, 'INVALID_EXPECTED_HEAD'), 'BOUNDED_CAPTURE_RANGE')
    hexhash(expected_hash)
    require(not out.exists() and out.name.endswith('.gz'), 'NEW_GZIP_OUTPUT_REQUIRED')
    out.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=out.name + '.staging-', dir=out.parent))
    record = {'status': 'RUNNING', 'range': {'from': 1, 'to': end}, 'source': {'height': expected_head, 'hash': expected_hash},
        'harness_sha256': sha(Path(__file__).read_bytes()), 'blocks': 0, 'transactions': 0,
        'limits': 'Node-reported mainnet/public RPC data; no consensus/SPV proof. Transaction insertion order retained. PrivateEndpoint limits each response to 32 MiB and each call to 20 seconds.'}
    save = lambda: (stage / 'capture.json').write_text(json.dumps(record, indent=2) + '\n')
    save(); started = time.monotonic()
    try:
        before = pin(source, expected_head, expected_hash); parent = GENESIS
        with (stage / 'blocks.jsonl').open('w', encoding='utf8') as blocks, (stage / 'transactions.jsonl').open('w', encoding='utf8') as transactions:
            for height in range(1, end + 1):
                blockhash = hexhash(source.rpc('getblockhash', [height]))
                block, rows = project_block(source.rpc('getblock', [blockhash, 2]), height, blockhash, parent)
                require(record['transactions'] + len(rows) <= MAX_ROWS, 'TRANSACTION_ROW_CAP')
                blocks.write(json.dumps(block, separators=(',', ':')) + '\n')
                for row in rows: transactions.write(json.dumps(row, separators=(',', ':')) + '\n')
                record['blocks'] += 1; record['transactions'] += len(rows); parent = blockhash
                if height % 128 == 0: save()
        require(pin(source, expected_head, expected_hash) == before, 'SOURCE_PIN_CHANGED')
        require(source.rpc('getblockhash', [end]) == parent, 'SOURCE_TIER_BOUNDARY_CHANGED')
        temporary = stage / 'oracle.json.gz'
        with temporary.open('xb') as raw:
            with gzip.GzipFile(fileobj=raw, mode='wb', filename='', mtime=0) as zipped:
                zipped.write(b'{"source":' + json.dumps(before, separators=(',', ':')).encode()
                    + b',"range":' + json.dumps(record['range'], separators=(',', ':')).encode() + b',"blocks":')
                write_array(zipped, stage / 'blocks.jsonl'); zipped.write(b',"transactions":')
                write_array(zipped, stage / 'transactions.jsonl'); zipped.write(b'}')
            raw.flush(); os.fsync(raw.fileno())
        with temporary.open('rb') as raw:
            checksum = hashlib.sha256()
            for chunk in iter(lambda: raw.read(1024**2), b''): checksum.update(chunk)
        # Same-filesystem no-clobber link publishes only complete closed gzip bytes.
        os.link(temporary, out)
        if os.name == 'posix':
            directory = os.open(out.parent, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
        record.update(status='PASS', sha256=checksum.hexdigest(), elapsed_seconds=time.monotonic()-started,
            output=str(out), tier_head_hash=parent)
        save()
        return record
    except BaseException as error:
        record.update(status='FAIL', error_type=type(error).__name__, error_code=str(error) if isinstance(error, ValueError) else 'CAPTURE_FAILED')
        save(); raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--expected-head', type=int, required=True)
    parser.add_argument('--expected-hash', required=True)
    parser.add_argument('--end', type=int, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(); out = args.out.resolve()
    results = Path(__file__).resolve().parents[3] / 'benchmarks/results'
    require(out != results.resolve() and out.is_relative_to(results.resolve()), 'OUTPUT_MUST_BE_IGNORED_RESULTS')
    record = capture(PrivateEndpoint(args.source), args.expected_head, args.expected_hash, args.end, out)
    print(json.dumps({'status': record['status'], 'blocks': record['blocks'], 'transactions': record['transactions'],
        'sha256': record['sha256'], 'output': str(out)}))


if __name__ == '__main__': main()
