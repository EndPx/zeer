"""Read-only closed-loop load against an operator-prepared private Prep or Chef.

No retries, service control, source RPC calls, database writes, or dependencies.
Run profiles separately in an externally bounded controller cgroup.
"""
import argparse
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import http.client
import ipaddress
import json
import math
import os
from pathlib import Path
import socket
import threading
import tempfile
import time
from urllib.parse import urlsplit

from benchmarks.prep.scale.run import FIELDS, load_oracle


def require(ok, code):
    if not ok:
        raise ValueError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def quantiles(values):
    """Nearest-rank observed quantiles, never interpolated invented samples."""
    ordered = sorted(values)
    return {'n': len(ordered), **{name: ordered[max(0, math.ceil(q * len(ordered)) - 1)] if ordered else None
        for name, q in [('p50', .5), ('p95', .95), ('p99', .99)]},
        'p99_tail_samples': len(ordered) // 100,
        'p99_interpretation': 'descriptive observed order statistic; not a tail guarantee'}


def classify(status, body):
    if status == 200:
        return 'http_200'
    code = body.get('error', {}).get('code') if isinstance(body, dict) and isinstance(body.get('error', {}), dict) else None
    messages = [item.get('message') for item in body.get('errors', []) if isinstance(item, dict)] if isinstance(body, dict) else []
    if status == 429 and code == 'QUERY_CAPACITY_EXCEEDED':
        return 'capacity_429'
    if status == 503 and any(message in ['Query capacity reached', 'Query admission deadline exceeded'] for message in messages):
        return 'capacity_503'
    if status == 503 and (code == 'SOURCE_NOT_READY' or 'Indexer is not ready' in messages):
        return 'unready_503'
    return f'unexpected_http_{status}'


class Http:
    def __init__(self, endpoint, token, timeout=30):
        parsed = urlsplit(endpoint)
        require(parsed.scheme == 'http' and parsed.hostname and not parsed.username and not parsed.password
                and parsed.path in ['', '/'] and not parsed.query and not parsed.fragment, 'PRIVATE_HTTP_ORIGIN_REQUIRED')
        # Freeze the resolved numeric private address; no redirects/proxy environment.
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 80, type=socket.SOCK_STREAM)}
        require(addresses and all(ipaddress.ip_address(address).is_loopback or any(
            ipaddress.ip_address(address) in ipaddress.ip_network(cidr)
            for cidr in ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) for address in addresses), 'PRIVATE_ADDRESS_REQUIRED')
        self.host, self.port, self.token, self.timeout = sorted(addresses)[0], parsed.port or 80, token, timeout

    def request(self, path, body=None):
        connection = http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)
        start = time.perf_counter_ns()
        try:
            connection.request('GET' if body is None else 'POST', path,
                None if body is None else json.dumps(body), {'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            raw = response.read(32 * 1024**2 + 1)
            require(len(raw) <= 32 * 1024**2, 'RESPONSE_LIMIT')
            decoded = json.loads(raw)
            return response.status, decoded, {'elapsed_ns': time.perf_counter_ns() - start, 'bytes': len(raw), 'http_completed_unix_ns': time.time_ns()}
        finally:
            connection.close()


def chef_rows(oracle):
    return sorted([dict(zip(['id', 'minedHeight', 'version', 'locktime', 'sizeBytes', 'transparentInputCount', 'transparentOutputCount'],
        [row['txid'], row['block_height'], row['version'], str(row['locktime']), row['size_bytes'], row['transparent_input_count'], row['transparent_output_count']]))
        for row in oracle['transactions']], key=lambda row: row['id'])


def cases(profile, oracle, anchor_height):
    """Fixed equal-weight mix; every case is exactly one admitted HTTP request."""
    start = oracle['headers'][0]['height']
    upper = min(anchor_height + 1, start + 128)
    tx = next(row for row in oracle['transactions'] if start <= row['block_height'] < upper)
    if profile == 'prep':
        def make(name, fields, lower=start, end=upper, txids=None):
            body = {'from_block': lower, 'to_block': end, 'limit': 128,
                    'field_selection': {'block': [], 'transaction': fields}}
            if txids is not None:
                body['transaction_filter'] = {'txids': txids}
            return {'name': name, 'path': '/query', 'body': body}
        return [make('small_id', ['txid', 'block_height'], tx['block_height'], tx['block_height'] + 1, [tx['txid']]),
            make('page', ['txid', 'block_height']),
            make('sparse', ['txid', 'block_height'], end=min(anchor_height + 1, start + 1000), txids=[tx['txid']]),
            make('full_metadata', FIELDS)]
    fields = 'id minedHeight version locktime sizeBytes transparentInputCount transparentOutputCount'
    def make(name, args, selected):
        return {'name': name, 'path': '/graphql', 'body': {'query': '{ _meta { height hash status } '
            + selected + ' }'}, 'options': args}
    return [make('small_id', {'id': tx['txid']}, 'PublicTransactionById(id:' + json.dumps(tx['txid']) + '){ id minedHeight }'),
        make('page', {'first': 100, 'fields': ['id', 'minedHeight']}, 'PublicTransactionList(first:100){ items { id minedHeight } nextCursor }'),
        make('sparse', {'first': 100, 'fields': ['id', 'minedHeight'], 'where': {'minedHeight': tx['block_height']}},
             'PublicTransactionList(first:100,where:{minedHeight:' + str(tx['block_height']) + '}){ items { id minedHeight } nextCursor }'),
        make('full_metadata', {'first': 100, 'fields': fields.split()}, 'PublicTransactionList(first:100){ items { ' + fields + ' } nextCursor }')]


class Verifier:
    def __init__(self, profile, oracle, anchor, active_min=None):
        self.profile, self.oracle, self.anchor, self.active_min = profile, oracle, anchor, active_min
        self.headers = {row['height']: row for row in oracle['headers']}
        self.rows = chef_rows(oracle) if profile == 'chef' else oracle['transactions']
        self.expected_cache = OrderedDict()
        self.cache_lock = threading.Lock()
        self.revision_heights = ({int(anchor['revision']): anchor['archive_height']}
            if profile == 'prep' and 'revision' in anchor else {})

    def cached_expected(self, key, build):
        with self.cache_lock:
            if key in self.expected_cache:
                value = self.expected_cache[key]
                self.expected_cache.move_to_end(key)
                return value
        expected = build()
        value = (expected, digest(expected))
        with self.cache_lock:
            self.expected_cache[key] = value
            self.expected_cache.move_to_end(key)
            while len(self.expected_cache) > 64:
                self.expected_cache.popitem(last=False)
        return value

    def expected_chef(self, case, height):
        options = case['options']
        available = [row for row in self.rows if row['minedHeight'] <= height]
        if 'id' in options:
            wanted = next((row for row in available if row['id'] == options['id']), None)
            return {key: wanted[key] for key in ['id', 'minedHeight']} if wanted else None
        matching = [row for row in available if all(row[key] == value for key, value in options.get('where', {}).items())]
        chosen = matching[:options['first']]
        return {'items': [{key: row[key] for key in options['fields']} for row in chosen],
            'nextCursor': chosen[-1]['id'] if len(matching) > options['first'] else None}

    def verify(self, case, body):
        if self.profile == 'chef':
            require(not body.get('errors') and isinstance(body.get('data'), dict), 'GRAPHQL_ERROR')
            meta = body['data']['_meta']; height = meta['height']
            require(type(height) is int, 'CHECKPOINT_HEIGHT_MUST_BE_INTEGER')
            require(meta['status'] == 'ready' and height in self.headers and meta['hash'] == self.headers[height]['hash'], 'CHECKPOINT_HASH_OR_STATUS')
            require((self.active_min <= height <= max(self.headers)) if self.active_min is not None else meta == self.anchor, 'CHECKPOINT_OUTSIDE_ALLOWED_SNAPSHOT')
            expected, expected_sha = self.cached_expected((case['name'], height), lambda: self.expected_chef(case, height))
            actual = body['data']['PublicTransactionById' if 'id' in case['options'] else 'PublicTransactionList']
            actual_sha = digest(actual)
            require(actual_sha == expected_sha, 'EXACT_ORACLE_ROWS_OR_CURSOR')
            return {'checkpoint': meta, 'row_count': (len(actual['items']) if isinstance(actual, dict) and 'items' in actual else int(actual is not None)), 'rows_sha256': actual_sha}
        height = body['archive_height']
        require(type(height) is int, 'PREP_HEIGHT_MUST_BE_INTEGER')
        require(height in self.headers and body['network'] == self.anchor['network'], 'PREP_SNAPSHOT_NETWORK_OR_HEIGHT')
        require(all(isinstance(body[key], str) and body[key].isdigit() for key in ['epoch', 'revision']), 'PREP_COUNTER_TYPES')
        if self.active_min is None:
            require(all(body[key] == self.anchor[key] for key in ['archive_height', 'epoch', 'revision']), 'PREP_SNAPSHOT_CHANGED')
        else:
            require(self.active_min <= height <= max(self.headers) and body['epoch'] == self.anchor['epoch'], 'PREP_ACTIVE_SNAPSHOT_OUTSIDE_ALLOWED_PREFIX')
            revision = int(body['revision'])
            require(revision >= int(self.anchor['revision']), 'PREP_REVISION_BEFORE_INITIAL_SNAPSHOT')
            with self.cache_lock:
                require(all((old_revision < revision and old_height <= height)
                    or (old_revision == revision and old_height == height)
                    or (old_revision > revision and old_height >= height)
                    for old_revision, old_height in self.revision_heights.items()), 'PREP_REVISION_HEIGHT_INCONSISTENCY')
                self.revision_heights[revision] = height
        request = case['body']; lower, upper = request['from_block'], request['to_block']
        require(all(type(body[key]) is int for key in ['from_block', 'to_block', 'next_block']), 'PREP_RANGE_MUST_BE_INTEGER')
        require(body['from_block'] == lower and body['to_block'] == upper and lower < body['next_block'] <= upper, 'PREP_RANGE_OR_PROGRESS')
        require((body['cursor'] is None) == (body['next_block'] == upper), 'PREP_CURSOR')
        selected = request['field_selection']['transaction']; ids = request.get('transaction_filter', {}).get('txids')
        expected, expected_sha = self.cached_expected((case['name'], body['next_block']), lambda: {'blocks': [], 'transactions': [
            {key: row[key] for key in selected} for row in self.rows
            if lower <= row['block_height'] < body['next_block'] and (ids is None or row['txid'] in ids)]})
        require(digest(body['data']) == expected_sha, 'EXACT_ORACLE_ROWS')
        return {'checkpoint': {key: body[key] for key in ['network', 'epoch', 'revision', 'archive_height']},
                'row_count': len(expected['transactions']), 'rows_sha256': digest(expected['transactions']), 'next_block': body['next_block']}


def summarize(samples, elapsed):
    counts = Counter(sample['outcome'] for sample in samples)
    good = [sample for sample in samples if sample['outcome'] == 'verified_200']
    return {'attempts': len(samples), 'outcomes': dict(counts), 'elapsed_seconds': elapsed,
        'attempts_per_second': len(samples) / elapsed, 'verified_successes_per_second': len(good) / elapsed,
        'response_body_bytes': sum(sample.get('bytes', 0) for sample in samples),
        'all_attempt_latency_ns': quantiles([sample['elapsed_ns'] for sample in samples]),
        'verified_200_latency_ns': quantiles([sample['elapsed_ns'] for sample in good]),
        'per_case': {name: {'attempts': sum(sample['case'] == name for sample in samples),
            'outcomes': dict(Counter(sample['outcome'] for sample in samples if sample['case'] == name)),
            'verified_200_latency_ns': quantiles([sample['elapsed_ns'] for sample in good if sample['case'] == name])}
            for name in sorted({sample['case'] for sample in samples})}}


def run_level(http, verifier, workloads, clients, per_client, deadline, think_ms=0):
    barrier = threading.Barrier(clients)
    def worker(client):
        output = []; barrier.wait()
        for index in range(per_client):
            if time.monotonic() >= deadline:
                break
            case = workloads[(client + index) % len(workloads)]
            start = time.perf_counter_ns()
            sample = {'client': client, 'sequence': index, 'case': case['name'], 'started_unix_ns': time.time_ns()}
            try:
                status, body, timing = http.request(case['path'], case['body'])
                sample.update(timing, http_status=status, outcome=classify(status, body))
                if status == 200:
                    sample.update(verifier.verify(case, body), outcome='verified_200')
                elif sample['outcome'] not in ['capacity_429', 'capacity_503', 'unready_503']:
                    sample['error_sha256'] = digest(body)
            except Exception as error:
                sample.update(outcome='verification_error' if sample.get('http_status') == 200 else 'transport_error',
                    error=type(error).__name__ + ':' + str(error)[:200])
            sample.setdefault('elapsed_ns', time.perf_counter_ns() - start)
            sample['completed_unix_ns'] = time.time_ns()
            output.append(sample)
            if think_ms:
                time.sleep(think_ms / 1000)
        return output
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=clients) as pool:
        samples = [sample for group in pool.map(worker, range(clients)) for sample in group]
    return {'clients': clients, 'samples': samples, 'summary': summarize(samples, time.perf_counter() - started)}


def snapshot(http, profile):
    status, body, _ = http.request('/height' if profile == 'prep' else '/graphql', None if profile == 'prep' else {'query': '{ _meta { height hash status } }'})
    require(status == 200, 'SNAPSHOT_HTTP_NOT_200')
    value = body if profile == 'prep' else body['data']['_meta']
    require(type(value['archive_height' if profile == 'prep' else 'height']) is int, 'SNAPSHOT_HEIGHT_MUST_BE_INTEGER')
    require(value.get('ready') is True if profile == 'prep' else value['status'] == 'ready', 'SNAPSHOT_NOT_READY')
    return value


def prep_head_proof(http, oracle, metadata):
    height = metadata['archive_height']
    reference = next(row for row in oracle['headers'] if row['height'] == height)
    status, body, _ = http.request('/query', {'from_block': height, 'to_block': height + 1, 'limit': 1,
        'field_selection': {'block': ['height', 'hash', 'time'], 'transaction': []}})
    require(status == 200 and all(type(body[key]) is int for key in ['archive_height', 'from_block', 'to_block', 'next_block'])
        and digest(body['data']) == digest({'blocks': [reference], 'transactions': []})
        and body['from_block'] == height and body['to_block'] == height + 1
        and body['next_block'] == height + 1 and body['cursor'] is None, 'PREP_HEAD_HASH_ORACLE_MISMATCH')
    return {'requested_head': reference, 'response_snapshot': {key: body[key] for key in ['archive_height', 'epoch', 'revision', 'network']}}


def release_writer(path, results_root, report_path):
    path = path.resolve()
    require(results_root.resolve() in path.parents and path != report_path.resolve(), 'START_SIGNAL_MUST_BE_NEW_IGNORED_RESULTS_FILE')
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.time_ns()
    value = {'event': 'load_preflight_passed', 'report': str(report_path.resolve()), 'unix_ns': str(stamp), 'unix_ms': stamp // 1_000_000}
    # Publish only the complete file, atomically and without replacing a prior signal.
    staging = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='.load-signal-', delete=False) as stream:
            staging = Path(stream.name)
            json.dump(value, stream)
        os.link(staging, path)
    finally:
        if staging is not None:
            staging.unlink()
    return value


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--profile', choices=['prep', 'chef'], required=True)
    p.add_argument('--endpoint', required=True)
    p.add_argument('--token-env', required=True)
    p.add_argument('--oracle', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--requests-per-client', type=int, default=40)
    p.add_argument('--min-successes-per-case', type=int, default=1)
    p.add_argument('--think-ms', type=int, default=0, help='Bounded closed-loop pause after every attempt, including rejections; outside HTTP timing')
    p.add_argument('--levels', default='1,2,4,8')
    p.add_argument('--timeout-seconds', type=int, default=30)
    p.add_argument('--max-seconds', type=int, default=300)
    p.add_argument('--active-min-height', type=int, help='Append-only ingest; oracle must cover the final allowed head. Never permits reorgs.')
    p.add_argument('--assert-final-height', type=int)
    p.add_argument('--start-signal-file', type=Path, help='Exclusively create an explicit ignored-results signal after successful preflight to release the prepared writer')
    p.add_argument('--exclusive-lock', type=Path, required=True, help='Shared host experiment lock, outside the individual output directory')
    a = p.parse_args()
    levels = [int(value) for value in a.levels.split(',')]
    require(levels and len(set(levels)) == len(levels) and all(value in [1, 2, 4, 8] for value in levels), 'INVALID_LEVELS')
    require(4 <= a.requests_per_client <= 1000 and a.requests_per_client % 4 == 0, 'REQUEST_COUNT_MULTIPLE_OF_FOUR_4_TO_1000')
    require(1 <= a.min_successes_per_case <= a.requests_per_client // 4, 'INVALID_MINIMUM_SUCCESS_COUNT')
    require(0 <= a.think_ms <= 100, 'THINK_MS_OUTSIDE_0_TO_100')
    require(1 <= a.timeout_seconds <= 30 and 1 <= a.max_seconds <= 1800, 'TIME_BOUNDS')
    require(a.token_env in os.environ and os.environ[a.token_env], 'TOKEN_ENV_REQUIRED')
    root = Path(__file__).resolve().parents[2] / 'benchmarks' / 'results'
    out = a.out.resolve(); require(out != root and root in out.parents, 'OUTPUT_MUST_BE_IGNORED_RESULTS')
    require(a.exclusive_lock.resolve() != out, 'LOCK_AND_OUTPUT_MUST_DIFFER')
    require(not out.exists(), 'OUTPUT_EXISTS')
    raw = a.oracle.read_bytes(); source = json.loads(gzip.decompress(raw) if a.oracle.suffix == '.gz' else raw)
    source = {'range': source['range'], 'source': source['source']}
    oracle = load_oracle(a.oracle, source['range']['from'], source['range']['to'])
    http = Http(a.endpoint, os.environ[a.token_env], a.timeout_seconds)
    # Exclusive creation never replaces another run's lock or evidence.
    a.exclusive_lock.parent.mkdir(parents=True, exist_ok=True)
    with a.exclusive_lock.open('x') as lock:
        lock.write(json.dumps({'pid': os.getpid(), 'profile': a.profile, 'out': str(out)}))
    report = {'format': 'zeer-http-load-v1', 'status': 'RUNNING', 'profile': a.profile,
        'oracle_sha256': oracle['sha256'], 'source': oracle['source'], 'range': source['range'],
        'harness_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'settings': {'levels': levels, 'requests_per_client': a.requests_per_client, 'min_successes_per_case': a.min_successes_per_case, 'think_ms_after_every_attempt': a.think_ms, 'expected_cache_entries': 64, 'http_timeout_seconds': a.timeout_seconds,
            'max_seconds': a.max_seconds, 'connection': 'fresh TCP per attempt', 'retries': 0,
            'active_min_height': a.active_min_height, 'assert_final_height': a.assert_final_height},
        'limitations': ['Closed-loop equal-weight four-case mix; no offered-rate or cold-cache claim.',
            'HTTP timer includes connection, complete body receipt and JSON decode; excludes oracle verification. Throughput includes client verification and scheduling. Frozen expected results/digests are precomputed in preflight; active expected prefixes use a 64-entry cache.',
            'Prep returns a bounded block-range page; Chef returns an ID-keyset entity page. Profiles are separate workloads, not an apples-to-apples service ranking.',
            'Full metadata selects all indexed scalar transaction metadata, not raw transaction payloads or decrypted shielded data.',
            'Operator must isolate and resource-bound the prepared services/controller. The lock prevents only cooperating harness runs using the same lock path.',
            'Active mode validates each successful response against one allowed canonical prefix; it does not prove reorg, crash durability, or that writes overlapped without external ingest timestamps.'],
        'levels': []}
    owns_output = False
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open('x') as stream:
            owns_output = True
            json.dump(report, stream, indent=2)
        def save():
            out.write_text(json.dumps(report, indent=2) + '\n')
        before = snapshot(http, a.profile); report['snapshot_before'] = before
        height = before['archive_height'] if a.profile == 'prep' else before['height']
        require(height in {header['height'] for header in oracle['headers']}, 'INITIAL_HEAD_OUTSIDE_ORACLE')
        if a.active_min_height is None:
            require(height == oracle['headers'][-1]['height'], 'FROZEN_HEAD_MUST_EQUAL_ORACLE_HEAD')
        else:
            require(oracle['headers'][0]['height'] <= a.active_min_height <= height, 'INVALID_ACTIVE_MIN_HEIGHT')
        verifier = Verifier(a.profile, oracle, before, a.active_min_height)
        if a.profile == 'prep':
            report['head_proof_before'] = prep_head_proof(http, oracle, before)
        workloads = cases(a.profile, oracle, a.active_min_height if a.active_min_height is not None else height)
        report['cases'] = workloads
        # Mandatory untimed exact-oracle admission before collecting load samples.
        for case in workloads:
            status, body, _ = http.request(case['path'], case['body'])
            require(status == 200, 'PREFLIGHT_NOT_200'); verifier.verify(case, body)
        if a.start_signal_file:
            require(a.active_min_height is not None, 'START_SIGNAL_REQUIRES_ACTIVE_MODE')
            report['writer_release'] = release_writer(a.start_signal_file, root, out)
            save()
        deadline = time.monotonic() + a.max_seconds
        for clients in levels:
            level = run_level(http, verifier, workloads, clients, a.requests_per_client, deadline, a.think_ms)
            report['levels'].append(level); save()
            require(level['summary']['attempts'] == clients * a.requests_per_client, 'DEADLINE_INCOMPLETE_SAMPLES')
            require(all(sample['outcome'] in ['verified_200', 'capacity_429', 'capacity_503', 'unready_503'] for sample in level['samples']), 'UNEXPECTED_RESPONSE_OR_ROW_MISMATCH')
            require(all(item['verified_200_latency_ns']['n'] >= a.min_successes_per_case for item in level['summary']['per_case'].values()), 'INSUFFICIENT_VERIFIED_SUCCESSES_PER_CASE')
            if a.active_min_height is None:
                require(all(sample['outcome'] != 'unready_503' for sample in level['samples']), 'FROZEN_SERVICE_BECAME_UNREADY')
                if clients == 1:
                    require(all(sample['outcome'] == 'verified_200' for sample in level['samples']), 'SINGLE_CLIENT_FROZEN_REJECTION')
            print(json.dumps({'clients': clients, **level['summary']}), flush=True)
        after = snapshot(http, a.profile); report['snapshot_after'] = after
        final_height = after['archive_height'] if a.profile == 'prep' else after['height']
        if a.profile == 'prep':
            report['head_proof_after'] = prep_head_proof(http, oracle, after)
        if a.active_min_height is None:
            keys = ['archive_height', 'epoch', 'revision', 'network'] if a.profile == 'prep' else ['height', 'hash', 'status']
            require(all(after[key] == before[key] for key in keys), 'FINAL_SNAPSHOT_CHANGED')
        else:
            require(a.active_min_height <= final_height <= oracle['headers'][-1]['height'], 'FINAL_HEIGHT_OUTSIDE_ORACLE')
            require(final_height > height, 'NO_INGEST_PROGRESS_DURING_RUN')
            if a.assert_final_height is not None:
                require(final_height == a.assert_final_height, 'FINAL_HEIGHT_NOT_EXPECTED')
        checkpoint_key = 'archive_height' if a.profile == 'prep' else 'height'
        observed = [sample['checkpoint'] for level in report['levels'] for sample in level['samples'] if sample['outcome'] == 'verified_200']
        unique = {digest(value): value for value in observed}
        report['observed_checkpoints'] = sorted(unique.values(), key=lambda value: (value[checkpoint_key], str(value.get('revision', ''))))
        if a.active_min_height is not None:
            require(len({value[checkpoint_key] for value in observed}) > 1, 'NO_MULTIPLE_SUCCESSFUL_RESPONSE_HEIGHTS_DURING_INGEST')
        for case in workloads:
            status, body, _ = http.request(case['path'], case['body'])
            require(status == 200, 'FINAL_PROBE_NOT_200'); verifier.verify(case, body)
        report['status'] = 'PASS'; save()
    except Exception as error:
        report.update(status='FAIL', error=type(error).__name__ + ':' + str(error)[:300])
        if owns_output: out.write_text(json.dumps(report, indent=2) + '\n')
        raise
    finally:
        a.exclusive_lock.unlink()


if __name__ == '__main__':
    main()
