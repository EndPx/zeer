import unittest
from types import SimpleNamespace
from unittest.mock import patch
import time

from benchmarks.adapters.compact_grpc import CompactGrpcAdapter, normalize_compact, rpc_hex
from benchmarks.runner.harness import BenchmarkError, DeadlineExceeded, freeze_manifest, run_benchmark


class CompactNormalizationTests(unittest.TestCase):
    def test_protocol_hash_reverses_to_rpc_order(self):
        self.assertEqual(rpc_hex(bytes(range(32))), "1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100")

    def test_hash_length_is_not_silently_padded(self):
        with self.assertRaises(BenchmarkError):
            rpc_hex(b"\0" * 31)

    def test_multiple_transactions_keep_source_order(self):
        block = SimpleNamespace(height=12, hash=bytes(range(32)), prevHash=b"\x33"*32,
                                vtx=[SimpleNamespace(txid=b"\x01"*32, outputs=[1]), SimpleNamespace(txid=b"\x02"*32, actions=[1])])
        actual = normalize_compact(block)
        self.assertEqual(actual["height"],12)
        self.assertEqual(actual["txids"],["01"*32,"02"*32])
        self.assertEqual(actual["prev_hash"],"33"*32)

    def test_empty_compact_block_remains_a_record(self):
        block=SimpleNamespace(height=1,hash=b"\x11"*32,prevHash=b"\x22"*32,vtx=[])
        self.assertEqual(normalize_compact(block)["txids"],[])

    def test_transparent_only_envelope_is_outside_declared_projection(self):
        block=SimpleNamespace(height=1,hash=b"\x11"*32,prevHash=b"\x22"*32,
                              vtx=[SimpleNamespace(txid=b"\x01"*32,vout=[1],spends=[],outputs=[],actions=[],ironwoodActions=[])])
        self.assertEqual(normalize_compact(block)["txids"],[])

    def test_native_grpc_timeout_stops_later_repetitions(self):
        class FakeRpcError(Exception):
            def code(self):return 'DEADLINE'
        class Stream:
            cancelled=False
            def __iter__(self):raise FakeRpcError()
            def cancel(self):self.cancelled=True
        stream=Stream()
        adapter=object.__new__(CompactGrpcAdapter)
        adapter.grpc=SimpleNamespace(RpcError=FakeRpcError,StatusCode=SimpleNamespace(DEADLINE_EXCEEDED='DEADLINE'))
        adapter.pb=SimpleNamespace(BlockID=lambda **k:k,BlockRange=lambda **k:k)
        adapter.stub=SimpleNamespace(GetBlockRange=lambda *a,**k:stream)
        adapter.request_count=0
        adapter.payload_bytes=0
        adapter.check_source=lambda *a:None
        manifest=freeze_manifest([{'height':1,'hash':'11'*32,'prev_hash':'22'*32,'txids':[]}],network='regtest',genesis_hash='22'*32,reference_name='fixture',reference_version='1',provenance='test',projection='shielded_compact')
        result=run_benchmark(adapter,manifest,candidate={'name':'fixture','version':'1','source_version':'1','endpoint':'grpc://localhost:1234'})
        self.assertEqual(result['runs'][0]['status'],'TIMEOUT')
        self.assertTrue(all(r['status']=='NOT_RUN' for r in result['runs'][1:]))
        self.assertTrue(stream.cancelled)

    def test_native_grpc_preflight_deadline_is_translated(self):
        class FakeRpcError(Exception):
            def code(self):return 'DEADLINE'
        adapter=object.__new__(CompactGrpcAdapter)
        adapter.grpc=SimpleNamespace(RpcError=FakeRpcError,StatusCode=SimpleNamespace(DEADLINE_EXCEEDED='DEADLINE'))
        adapter.pb=SimpleNamespace(Empty=lambda:None)
        adapter.stub=SimpleNamespace(GetLightdInfo=lambda *a,**k:(_ for _ in ()).throw(FakeRpcError()))
        adapter.request_count=0
        with self.assertRaises(DeadlineExceeded):
            adapter.check_source({'projection':'shielded_compact'},time.monotonic()+1)

    def test_preparation_aborts_when_generation_does_not_advance(self):
        from benchmarks.scripts import prepare_regtest
        responses=['029f11d80ef9765602235e1bc9727e3eb6ba20839319f761fee920d63401e327',{'blocks':0},[],{'blocks':0}]
        with patch('sys.argv',['prepare','--endpoint','http://localhost:1','--end','2','--output','unused']),patch.object(prepare_regtest,'call',side_effect=responses):
            with self.assertRaisesRegex(RuntimeError,'did not advance'):
                prepare_regtest.main()

    def test_memory_budget_includes_client(self):
        from benchmarks.scripts.run_compact import validate_resource_budget
        with self.assertRaisesRegex(ValueError,'memory authorization'):
            validate_resource_budget([{'cpu_quota':1,'memory_bytes':4*1024**3}],1,256*1024**2)

    def test_unlimited_server_resources_are_rejected(self):
        from benchmarks.scripts.run_compact import validate_resource_budget
        with self.assertRaisesRegex(ValueError,'finite limits'):
            validate_resource_budget([{'cpu_quota':1,'memory_bytes':0}],1,256*1024**2)

    def test_measured_resource_allocation_fits_exact_budget(self):
        from benchmarks.scripts.run_compact import validate_resource_budget
        validate_resource_budget([{'cpu_quota':.25,'memory_bytes':1280*1024**2},{'cpu_quota':.75,'memory_bytes':2560*1024**2}],1,256*1024**2)


if __name__ == "__main__":
    unittest.main()
