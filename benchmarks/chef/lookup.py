"""Chef GraphQL adapter for the verified early-mainnet transaction lookup task.

Invoke from the repository root: python -m benchmarks.chef.lookup ...
This measures prepared serving, not ingestion, and never writes a database.
"""
import argparse
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from benchmarks.transactions.benchmark import (
    DataError, failure_fields, normalize_record, remaining, run_benchmark,
    validate_manifest, write_report,
)

MAX_RESPONSE = 2 * 1024 * 1024
QUERY = "query($id: ID!) { PublicTransactionById(id: $id) { id minedHeight version locktime sizeBytes transparentInputCount transparentOutputCount } }"


class JsonConnection:
    def __init__(self, endpoint, *, token=None, graphql=False):
        parts = urlsplit(endpoint)
        if (parts.scheme not in {"http", "https"} or not parts.hostname
                or parts.username or parts.password or parts.query or parts.fragment):
            raise DataError("invalid_http_endpoint")
        self.connection = (http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection)(
            parts.hostname, parts.port, timeout=20)
        self.path = parts.path or ("/graphql" if graphql else "/")
        if graphql and self.path == "/":
            self.path = "/graphql"
        self.headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if token:
            self.headers["Authorization"] = "Bearer " + token
        self.response_bytes = 0

    def request(self, value, deadline):
        timeout = min(20, remaining(deadline))
        self.connection.timeout = timeout
        if self.connection.sock:
            self.connection.sock.settimeout(timeout)
        body = json.dumps(value, separators=(",", ":")).encode()
        self.connection.request("POST", self.path, body=body, headers=self.headers)
        response = self.connection.getresponse()
        raw = response.read(MAX_RESPONSE + 1)
        self.response_bytes += len(raw)
        if len(raw) > MAX_RESPONSE:
            self.connection.close()
            raise DataError("http_response_too_large")
        if response.status != 200:
            raise DataError("http_non_success")
        remaining(deadline)
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise DataError("http_response_not_object")
        return value

    def close(self):
        self.connection.close()


class ChefTransactionAdapter:
    def __init__(self, chef_url, source_url, *, token=None):
        self.chef = JsonConnection(chef_url, token=token, graphql=True)
        self.source = JsonConnection(source_url)
        self.source_observations = []

    def graphql(self, query, variables, deadline):
        response = self.chef.request({"query": query, "variables": variables}, deadline)
        if response.get("errors") or not isinstance(response.get("data"), dict):
            raise DataError("graphql_missing_data_or_errors")
        return response["data"]

    def rpc(self, method, params, deadline):
        response = self.source.request({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, deadline)
        if response.get("error") or "result" not in response:
            raise DataError("source_rpc_failed")
        return response["result"]

    def preflight(self, manifest, deadline):
        info = self.rpc("getblockchaininfo", [], deadline)
        if not isinstance(info, dict) or info.get("chain") not in {"main", "mainnet"}:
            raise DataError("source_network_mismatch")
        if info.get("blocks") != manifest["end_height"] or info.get("bestblockhash") != manifest["end_hash"]:
            raise DataError("source_frozen_head_mismatch")
        genesis = self.rpc("getblockhash", [0], deadline)
        if genesis != manifest["genesis_hash"]:
            raise DataError("source_genesis_mismatch")
        app_height = manifest["selection_end_height"]
        app_hash = self.rpc("getblockhash", [app_height], deadline)
        expected_hash = next((block["hash"] for block in manifest["blocks"] if block["height"] == app_height), None)
        if expected_hash is None or app_hash != expected_hash:
            raise DataError("source_application_boundary_mismatch")
        meta = self.graphql("{ _meta { height hash status } }", {}, deadline).get("_meta")
        if not isinstance(meta, dict) or meta.get("status") != "ready":
            raise DataError("chef_not_ready")
        if meta.get("height") != app_height or meta.get("hash") != app_hash:
            raise DataError("chef_application_boundary_mismatch")
        self.source_observations.append({"source_height": info["blocks"], "source_hash": info["bestblockhash"],
                                         "application_height": app_height, "application_hash": app_hash})

    def lookup(self, txid, deadline):
        item = self.graphql(QUERY, {"id": txid}, deadline).get("PublicTransactionById")
        if not isinstance(item, dict) or item.get("id") != txid:
            raise DataError("chef_missing_or_wrong_transaction")
        locktime = item.get("locktime")
        if not isinstance(locktime, str) or re.fullmatch(r"0|[1-9][0-9]{0,9}", locktime) is None:
            raise DataError("chef_locktime_not_canonical_integer_string")
        return normalize_record({"txid": item["id"], "mined_height": item.get("minedHeight"),
                                 "version": item.get("version"), "locktime": int(locktime),
                                 "size_bytes": item.get("sizeBytes"),
                                 "transparent_input_count": item.get("transparentInputCount"),
                                 "transparent_output_count": item.get("transparentOutputCount")})

    def close(self):
        self.chef.close()
        self.source.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--chef-url", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--token-env", default="CHEF_API_TOKEN")
    parser.add_argument("--version", default="working-tree")
    parser.add_argument("--source-version", default="Zakura1.5.0")
    parser.add_argument("--profile", default="shared-vps-mainnet-prefix-chef-v1")
    parser.add_argument("--timeout", default=120.0, type=float)
    args = parser.parse_args()
    adapter = None
    try:
        if any(args.out.with_suffix(suffix).exists() for suffix in (".json", ".md")):
            raise DataError("report_already_exists")
        manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
        validate_manifest(manifest)
        adapter = ChefTransactionAdapter(args.chef_url, args.source_url, token=os.environ.get(args.token_env))
        started = datetime.datetime.now(datetime.timezone.utc).isoformat()
        report = run_benchmark(adapter, manifest,
                               candidate={"name": "Zeer Chef", "version": args.version,
                                          "source_version": args.source_version, "endpoint": args.chef_url},
                               profile=args.profile, repetitions=5, stage_timeout_s=args.timeout)
        report["started_at"] = started
        report["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        report["chef_adapter_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        report["source_observations"] = adapter.source_observations
        report["response_bytes_including_warmup_and_anchors"] = adapter.chef.response_bytes
        report["limitations"].extend([
            "Chef serves previously committed PostgreSQL entities through GraphQL; ingestion time is recorded separately.",
            "Chef indexed boundary is selection_end_height, while the preserved source stays at end_height.",
            "Compare with fresh local candidate runs separately from earlier dated measurements.",
        ])
        write_report(report, args.out)
        print(json.dumps(report["summary"]))
        return 0 if report["summary"]["status"] == "PASS" else 1
    except Exception as error:
        print(json.dumps({**failure_fields(error), "status": "ERROR"}))
        return 2
    finally:
        if adapter:
            adapter.close()


if __name__ == "__main__":
    raise SystemExit(main())
