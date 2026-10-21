"""Correctness regressions for the modern read-only comparison, not performance tests."""
import copy
import http.server
import threading
import time
import unittest

from benchmarks.prep.full.retrieval import Http

from benchmarks.prep.rpc.compare import Prep, Rpc, digest, header, matches, measure, normalize, output_addresses, transaction


def tx(txid="a" * 64, height=42, addresses=("target",)):
    return {"txid": txid, "height": height, "in_active_chain": True, "version": 6, "locktime": 0,
            "vin": [{"coinbase": "00"}], "vout": [{"scriptPubKey": {"addresses": list(addresses)}, "value": "0.1"}],
            "vShieldedSpend": [{}, {}], "vShieldedOutput": [{}],
            "orchard": {"actions": [{}, {}, {}]}, "ironwood": {"actions": [{}, {}, {}, {}]}}


class ComparisonTests(unittest.TestCase):
    def test_trickling_http_body_cannot_extend_absolute_deadline(self):
        class Trickle(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                body = b'{"slow":true}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    for value in body:
                        self.wfile.write(bytes([value])); self.wfile.flush(); time.sleep(.02)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Trickle)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        client = Http(f"http://127.0.0.1:{server.server_port}", deadline=time.monotonic() + .08)
        try:
            with self.assertRaises((ValueError, TimeoutError)):
                client.request("/")
        finally:
            client.close(); server.shutdown(); server.server_close(); thread.join()

    def test_late_adapter_result_is_not_accepted(self):
        class Adapter:
            timeout = 1
            def stats(self): return {"requests": 0, "response_bytes": 0}
            def retrieve(self, manifest, workload): self.deadline = 0; return []
        with self.assertRaisesRegex(ValueError, "GLOBAL_DEADLINE_EXCEEDED"):
            measure(Adapter(), {"expected": {"headers": []}, "expected_sha256": {"headers": digest([])}}, "headers")

    def test_projection_uses_component_counts_and_actual_coinbase_marker(self):
        row = transaction(tx(), 42)
        self.assertEqual((row["sapling_spend_count"], row["sapling_output_count"], row["orchard_action_count"], row["ironwood_action_count"]), (2, 1, 3, 4))
        self.assertTrue(row["is_coinbase"])
        ordinary = tx(); ordinary["vin"] = [{"txid": "b" * 64}]
        self.assertFalse(transaction(ordinary, 42)["is_coinbase"])
        self.assertEqual(set(row), {"txid", "block_height", "version", "locktime", "is_coinbase", "transparent_input_count", "transparent_output_count", "sapling_spend_count", "sapling_output_count", "orchard_action_count", "ironwood_action_count"})
        for pool in ["sapling", "orchard", "ironwood"]:
            self.assertTrue(matches(row, pool))
        bad = tx(); bad["ironwood"] = "unparsed"
        with self.assertRaisesRegex(ValueError, "INVALID_POOL_BUNDLE"):
            transaction(bad, 42)

    def test_addresses_support_singular_and_plural_and_do_not_use_inputs(self):
        value = tx(addresses=("first", "first")); value["vout"].append({"scriptPubKey": {"address": "second"}})
        value["vin"] = [{"address": "sender"}]
        self.assertEqual(output_addresses(value), {"first", "second"})

    def test_rpc_address_path_uses_native_index_then_checks_output_and_range(self):
        manifest = {"from_block": 42, "to_block": 43, "address": "target"}
        data = {"a" * 64: tx(), "b" * 64: tx("b" * 64, addresses=("someone_else",)), "c" * 64: tx("c" * 64, height=43)}
        calls = []
        rpc = Rpc("http://127.0.0.1:1")
        def call(method, params):
            calls.append((method, params))
            if method == "getaddresstxids":
                return ["a" * 64, "a" * 64, "b" * 64, "c" * 64]
            return data[params[0]]
        rpc.call = call
        try:
            self.assertEqual(rpc.retrieve(manifest, "address"), [transaction(data["a" * 64], 42)])
            self.assertEqual(calls[0], ("getaddresstxids", [{"addresses": ["target"], "start": 42, "end": 42}]))
            self.assertEqual(sum(method == "getrawtransaction" for method, _ in calls), 3)
        finally:
            rpc.close()

    def test_rpc_headers_use_height_lookup_without_known_hash_preload(self):
        rpc = Rpc("http://127.0.0.1:1"); calls = []
        def call(method, params):
            calls.append((method, params)); h = int(params[0])
            return {"height": h, "hash": f"{h:064x}", "previousblockhash": f"{h-1:064x}", "time": 100}
        rpc.call = call
        try:
            rows = rpc.retrieve({"from_block": 42, "to_block": 44}, "headers")
            self.assertEqual([r["height"] for r in rows], [42, 43])
            self.assertEqual({name for name, _ in calls}, {"getblockheader"})
        finally:
            rpc.close()

    def test_prep_empty_pages_continue_and_terminal_page_must_complete(self):
        manifest = {"from_block": 42, "to_block": 44}
        base = {"network": "testnet", "epoch": "1", "from_block": 42, "to_block": 44,
                "next_block": 43, "cursor": "continue", "data": {"blocks": [], "transactions": []}}
        final = {**base, "next_block": 44, "cursor": None}
        prep = Prep("http://127.0.0.1:1"); prep.deadline = 9999999999
        class Fake:
            def __init__(self, pages): self.pages = iter(pages); self.calls = []
            def request(self, path, body): self.calls.append(copy.deepcopy(body)); return next(self.pages)
        prep.http = Fake([base, final]); self.assertEqual(prep.retrieve(manifest, "transactions"), [])
        self.assertEqual(prep.http.calls[1]["cursor"], "continue")
        prep.http = Fake([{**base, "cursor": None}])
        with self.assertRaisesRegex(ValueError, "PREP_INCOMPLETE"): prep.retrieve(manifest, "transactions")
        prep.http = Fake([base, {**final, "epoch": "2"}])
        with self.assertRaisesRegex(ValueError, "PREP_CHANGED_OR_TRUNCATED"): prep.retrieve(manifest, "transactions")

    def test_measure_verifies_all_rows_not_just_counts(self):
        class Adapter:
            timeout = 1
            def stats(self): return {"requests": 0, "response_bytes": 0}
            def retrieve(self, manifest, workload): return [{"height": 1}]
        expected = [{"height": 2}]
        with self.assertRaisesRegex(ValueError, "RESULT_MISMATCH"):
            measure(Adapter(), {"expected": {"headers": expected}, "expected_sha256": {"headers": digest(expected)}}, "headers")

    def test_numeric_and_order_projection_are_not_serialization_order_dependent(self):
        self.assertEqual(digest([{"a": 1, "b": 2}]), digest([{"b": 2, "a": 1}]))
        self.assertEqual([r["txid"] for r in normalize([{"block_height": 1, "txid": "b"}, {"block_height": 1, "txid": "a"}], "transactions")], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
