"""Compare Prep gRPC output to a separately captured public reference.

This is a correctness smoke and local-serving observation, not an indexer ranking.
Generate prep_pb2/grpc and the pinned upstream compact protobuf bindings first.
"""
import argparse
import hashlib
import json
import pathlib
import statistics
import struct
import time

import grpc
import compact_formats_pb2 as compact
import prep_pb2 as p
import prep_pb2_grpc as g


def frames(path):
    if path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("reference_exceeds_smoke_bound")
    raw = path.read_bytes()
    result, offset = [], 0
    while offset < len(raw):
        if offset + 4 > len(raw):
            raise ValueError("truncated_reference")
        size = struct.unpack_from('<I', raw, offset)[0]
        offset += 4
        if not 0 < size <= 4 * 1024 * 1024 or offset + size > len(raw):
            raise ValueError("invalid_reference_frame")
        result.append(raw[offset:offset + size])
        offset += size
    return raw, result


def normalize(payload):
    block = compact.CompactBlock.FromString(payload)
    return block.SerializeToString(deterministic=True)


def run(args):
    reference = json.loads((args.reference / 'modern-source.json').read_text())
    raw, expected = frames(args.reference / 'mainnet-2700000-2700255.pbframes')
    assert hashlib.sha256(raw).hexdigest() == reference['raw_sha256']
    start, end = reference['start'], reference['end']
    assert len(expected) == end - start + 1
    expected = [normalize(x) for x in expected]
    # Intended for a loopback tunnel or private benchmark network only.
    ch = grpc.insecure_channel(args.endpoint, options=[('grpc.max_receive_message_length',8*1024*1024)])
    client = g.PrepStub(ch)
    info = client.GetInfo(p.InfoRequest(), timeout=10)
    assert info.network == 'mainnet'
    assert info.start_height == start and info.end_height == end

    def fetch(first, last, batch):
        records, cursor, batches = [], first, 0
        for response in client.GetRange(p.RangeRequest(dataset_id=info.dataset_id,
                start_height=first, end_height=last, batch_blocks=batch), timeout=30):
            assert response.dataset_id == info.dataset_id and response.start_height == cursor
            assert 0 < len(response.compact_blocks) <= batch
            for payload in response.compact_blocks:
                block = compact.CompactBlock.FromString(payload)
                assert block.height == cursor
                records.append(block.SerializeToString(deterministic=True))
                cursor += 1
            assert response.next_height == cursor
            batches += 1
        assert cursor == last + 1
        return records, batches

    warm, _ = fetch(start, end, 32)
    assert warm == expected
    samples = []
    for i in range(5):
        begin = time.perf_counter_ns()
        actual, count = fetch(start, end, 32)
        elapsed = time.perf_counter_ns() - begin
        assert actual == expected
        samples.append({'run':i+1,'elapsed_ns':elapsed,'batches':count,'status':'PASS'})
    # A new request can resume a deterministic subrange with the same dataset ID.
    middle = start + len(expected)//2
    left, _ = fetch(start, middle-1, 1)
    right, _ = fetch(middle, end, 7)
    assert left + right == expected
    invalid = []
    for name, request, expected_code in [
        ('wrong_dataset',p.RangeRequest(dataset_id='0'*64,start_height=start,end_height=end),grpc.StatusCode.FAILED_PRECONDITION),
        ('outside_range',p.RangeRequest(dataset_id=info.dataset_id,start_height=start-1,end_height=end),grpc.StatusCode.OUT_OF_RANGE),
        ('invalid_batch',p.RangeRequest(dataset_id=info.dataset_id,start_height=start,end_height=end,batch_blocks=129),grpc.StatusCode.INVALID_ARGUMENT),
    ]:
        try:
            list(client.GetRange(request,timeout=10))
        except grpc.RpcError as error:
            assert error.code() == expected_code, (name,error.code())
            invalid.append({'case':name,'code':error.code().name,'status':'PASS'})
        else:
            raise AssertionError(name+' unexpectedly accepted')
    post = client.GetInfo(p.InfoRequest(),timeout=10)
    assert post == info
    result = {'schema_version':1,'status':'PASS','dataset_id':info.dataset_id,
        'start':start,'end':end,'counts':reference['counts'], 'verified_blocks':len(expected),
        'verification':'Every normalized pinned-schema CompactBlock equals independent Python provider capture',
        'warmup':'PASS','resume_subranges':'PASS','invalid_requests':invalid,'postflight':'PASS',
        'runs':samples,'median_local_serving_ms':statistics.median(x['elapsed_ns'] for x in samples)/1e6,
        'timing_boundary':'Local private-network fetch + Python decode/serialize + cursor checks; full reference comparison outside timer',
        'limitation':'One local snapshot service, not comparative throughput, wallet scanning or production evidence'}
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
    ch.close()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference',type=pathlib.Path,required=True)
    parser.add_argument('--endpoint',default='127.0.0.1:39367')
    parser.add_argument('--output',type=pathlib.Path,required=True)
    options=parser.parse_args()
    if options.output.exists():
        raise SystemExit('Refusing to replace an existing result')
    run(options)
