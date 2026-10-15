"""Generate six bounded native-query expectations from an independent node oracle."""
import argparse
import hashlib
import json
from pathlib import Path
import re

from benchmarks.prep.scale.run import FIELDS, load_oracle

MAX_BYTES = 8 * 1024**2
REFERENCE_FIELDS = ['directory', 'dataset_id', 'start_height', 'end_height',
                    'predecessor_hash', 'end_hash', 'manifest_sha256']


def require(ok, code):
    if not ok:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical_bytes(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def read_catalog(archive):
    require(not archive.is_symlink(), 'ARCHIVE_SYMLINK')
    path = archive / 'catalog.json' if archive.is_dir() else archive
    require(path.name == 'catalog.json' and path.is_file() and not path.is_symlink(), 'REGULAR_CATALOG_REQUIRED')
    require(path.stat().st_size <= 16 * 1024**2, 'CATALOG_SIZE')
    catalog = json.loads(path.read_bytes())
    require(catalog['schema_version'] == 1 and catalog['payload_kind'] == 'full-v1'
            and catalog['network'] == 'mainnet' and catalog['segments'], 'FULL_MAINNET_CATALOG_REQUIRED')
    require(all(type(catalog[key]) is int and 0 <= catalog[key] < 2**64
                for key in ['start_height', 'epoch', 'revision']), 'CATALOG_COUNTER_TYPES')
    segments = [{key: ref[key] for key in REFERENCE_FIELDS} for ref in catalog['segments']]
    start = catalog['start_height']
    previous = None
    names = set()
    for ref in segments:
        require(re.fullmatch(r'segments/[A-Za-z0-9_-]{1,128}', ref['directory'])
                and ref['directory'] not in names, 'CATALOG_SEGMENT_DIRECTORY')
        names.add(ref['directory'])
        require(type(ref['start_height']) is int and type(ref['end_height']) is int
                and ref['start_height'] == start <= ref['end_height'] <= 0xffffffff,
                'CATALOG_SEGMENT_RANGE')
        require(all(isinstance(ref[key], str) and re.fullmatch('[0-9a-f]{64}', ref[key])
                    for key in ['dataset_id', 'predecessor_hash', 'end_hash', 'manifest_sha256']),
                'CATALOG_SEGMENT_HASH')
        require(previous is None or ref['predecessor_hash'] == previous, 'CATALOG_PARENT_LINK')
        previous = ref['end_hash']
        start = ref['end_height'] + 1
    require(catalog['epoch'] <= catalog['revision'] and len(segments) <= catalog['revision'], 'CATALOG_REVISION')
    expected = sha(canonical_bytes(['zeer-prep-catalog-v1', catalog['schema_version'],
        catalog['network'], catalog['payload_kind'], catalog['start_height'],
        catalog['epoch'], catalog['revision'], segments]))
    require(catalog['catalog_sha256'] == expected, 'CATALOG_CHECKSUM')
    return catalog, path.resolve()


def make_cases(archive, oracle_path):
    catalog, _ = read_catalog(archive)
    start, head = catalog['start_height'], catalog['segments'][-1]['end_height']
    count = head - start + 1
    require(start > 0 and 384 <= count <= 32768, 'ARCHIVE_REQUIRES_384_THROUGH_32768_BLOCKS')
    oracle = load_oracle(oracle_path, start, head)
    require(oracle['headers'][-1]['hash'] == catalog['segments'][-1]['end_hash'], 'ORACLE_HEAD_HASH')
    source = oracle['source']
    require(type(source['height']) is int and source['height'] >= head, 'ORACLE_SOURCE_HEIGHT')
    require(isinstance(source['hash'], str) and re.fullmatch('[0-9a-f]{64}', source['hash']), 'ORACLE_SOURCE_HASH')
    if source['height'] == head:
        require(source['hash'] == oracle['headers'][-1]['hash'], 'ORACLE_SOURCE_HEAD_HASH')
    identity = {'network': catalog['network'], 'start_height': start, 'head': head,
                'head_hash': oracle['headers'][-1]['hash'], 'epoch': catalog['epoch'],
                'revision': catalog['revision'], 'catalog_sha256': catalog['catalog_sha256']}
    output = {'format': 'prep-admission-query-cases-v1', 'oracle_sha256': oracle['sha256'],
              'archive': identity, 'cases': []}
    # Match first/middle/end windows used by the measured 32,768-block tier.
    windows = [('first', start), ('middle', start + count // 2), ('end', head - 127)]
    for label, lower in windows:
        upper = lower + 128
        require(start <= lower < upper <= head + 1, 'WINDOW_OUTSIDE_ARCHIVE')
        rows = [{key: row[key] for key in FIELDS} for row in oracle['transactions']
                if lower <= row['block_height'] < upper]
        require(rows, 'WINDOW_HAS_NO_TRANSACTIONS')
        # Stable source order breaks equal-distance ties, never hash or sort rows.
        selected = min(rows, key=lambda row: abs(row['block_height'] - (lower + 64)))['txid']
        request = {'from_block': lower, 'to_block': upper, 'limit': 128,
                   'field_selection': {'block': [], 'transaction': FIELDS}}
        output['cases'].append({'name': label + '_metadata', 'request': request,
                                'expected': {'blocks': [], 'transactions': rows}})
        output['cases'].append({'name': label + '_sparse',
            'request': {**request, 'transaction_filter': {'txids': [selected]}},
            'expected': {'blocks': [], 'transactions': [row for row in rows if row['txid'] == selected]}})
    require(len(canonical_bytes(output)) <= MAX_BYTES, 'CASES_EXCEED_8_MIB')
    return output


def publish(value, out, results, archive, oracle):
    out = out.resolve()
    results = results.resolve()
    require(out != results and out.is_relative_to(results), 'OUTPUT_MUST_BE_IGNORED_RESULTS')
    _, catalog_path = read_catalog(archive)
    require(not out.is_relative_to(catalog_path.parent) and out != oracle.resolve(), 'OUTPUT_MUST_NOT_CHANGE_INPUTS')
    raw = canonical_bytes(value) + b'\n'
    require(len(raw) <= MAX_BYTES, 'CASES_EXCEED_8_MIB')
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('xb') as stream:
        stream.write(raw)
    return {'format': value['format'], 'cases': len(value['cases']), 'bytes': len(raw),
            'cases_sha256': sha(raw), 'oracle_sha256': value['oracle_sha256'],
            'catalog_sha256': value['archive']['catalog_sha256']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ['archive', 'oracle', 'out']:
        parser.add_argument('--' + flag, type=Path, required=True)
    args = parser.parse_args()
    value = make_cases(args.archive, args.oracle)
    results = Path(__file__).resolve().parents[3] / 'benchmarks/results'
    print(json.dumps(publish(value, args.out, results, args.archive, args.oracle)))


if __name__ == '__main__':
    main()
