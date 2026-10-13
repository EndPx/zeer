"""Admission and output-normalization tests; synthetic responses, not chain proof."""
import http.server
import json
from pathlib import Path
import threading
import time
import unittest

from benchmarks.chef.lookup import ChefTransactionAdapter, JsonConnection
from benchmarks.transactions.benchmark import DataError, normalize_record

MANIFEST = json.loads((Path(__file__).resolve().parents[1] / "fixtures/mainnet-transactions-v1/manifest.json").read_text())


class AdmissionTests(unittest.TestCase):
    def adapter(self):
        adapter = ChefTransactionAdapter("http://127.0.0.1:1", "http://127.0.0.1:2")
        self.addCleanup(adapter.close)
        boundary = next(block["hash"] for block in MANIFEST["blocks"] if block["height"] == 2048)
        adapter.rpc = lambda method, params, deadline: (
            {"chain": "main", "blocks": 6764, "bestblockhash": MANIFEST["end_hash"]}
            if method == "getblockchaininfo" else MANIFEST["genesis_hash"] if params == [0] else boundary)
        adapter.graphql = lambda query, variables, deadline: {"_meta": {"height": 2048, "hash": boundary, "status": "ready"}}
        return adapter

    def test_source_and_app_heights_are_distinct(self):
        adapter = self.adapter()
        adapter.preflight(MANIFEST, time.monotonic() + 10)
        self.assertEqual(adapter.source_observations[0]["source_height"], 6764)
        self.assertEqual(adapter.source_observations[0]["application_height"], 2048)

    def test_wrong_source_head_fails(self):
        adapter = self.adapter()
        adapter.rpc = lambda *args: {"chain": "main", "blocks": 6765, "bestblockhash": MANIFEST["end_hash"]}
        with self.assertRaisesRegex(DataError, "source_frozen_head_mismatch"):
            adapter.preflight(MANIFEST, time.monotonic() + 10)

    def test_wrong_app_boundary_and_not_ready_fail(self):
        adapter = self.adapter()
        for meta in ({"height": 6764, "hash": MANIFEST["end_hash"], "status": "ready"},
                     {"height": 2048, "hash": "0" * 64, "status": "ready"},
                     {"height": 2048, "hash": "0" * 64, "status": "reconciling"}):
            with self.subTest(meta=meta), self.assertRaises(DataError):
                adapter.graphql = lambda *args: {"_meta": meta}
                adapter.preflight(MANIFEST, time.monotonic() + 10)

    def test_all_seven_fields_match_reference(self):
        adapter = self.adapter()
        for row in MANIFEST["records"]:
            output = {"id": row["txid"], "minedHeight": row["mined_height"], "version": row["version"],
                      "locktime": str(row["locktime"]), "sizeBytes": row["size_bytes"],
                      "transparentInputCount": row["transparent_input_count"],
                      "transparentOutputCount": row["transparent_output_count"]}
            adapter.graphql = lambda *args: {"PublicTransactionById": output}
            self.assertEqual(adapter.lookup(row["txid"], time.monotonic() + 10), normalize_record(row))

    def test_invalid_locktime_or_wrong_id_fails(self):
        adapter = self.adapter()
        row = MANIFEST["records"][0]
        for locktime in (0, True, "00", "1e2", "-1", "4294967296"):
            adapter.graphql = lambda *args: {"PublicTransactionById": {"id": row["txid"], "locktime": locktime}}
            with self.subTest(locktime=locktime), self.assertRaises(DataError):
                adapter.lookup(row["txid"], time.monotonic() + 10)
        adapter.graphql = lambda *args: {"PublicTransactionById": {"id": "0" * 64}}
        with self.assertRaisesRegex(DataError, "chef_missing_or_wrong_transaction"):
            adapter.lookup(row["txid"], time.monotonic() + 10)


class TransportTests(unittest.TestCase):
    def test_persistent_connection_and_bearer_header(self):
        observations = []
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["content-length"])))
                observations.append((self.client_address, self.path, self.headers.get("Authorization"), payload))
                body = b'{"data":{"value":1}}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        connection = JsonConnection(f"http://127.0.0.1:{server.server_port}", token="test-only-token", graphql=True)
        try:
            for _ in range(2):
                self.assertEqual(connection.request({"query": "test"}, time.monotonic() + 5), {"data": {"value": 1}})
            self.assertEqual(observations[0][0], observations[1][0])
            self.assertEqual(observations[0][1:3], ("/graphql", "Bearer test-only-token"))
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join()

    def test_rejects_credentials_queries_and_fragments(self):
        for endpoint in ("http://user:pass@host", "http://host?token=secret", "http://host#secret", "file:///secret"):
            with self.subTest(endpoint=endpoint), self.assertRaises(DataError):
                JsonConnection(endpoint)


if __name__ == "__main__":
    unittest.main()
