"""Read the common lightwalletd protocol; no decryption or persistence engine."""
from __future__ import annotations

import time
from urllib.parse import urlsplit

from benchmarks.runner.harness import BenchmarkError, DeadlineExceeded


def rpc_hex(raw: bytes) -> str:
    if len(raw) != 32:
        raise BenchmarkError("invalid_protocol_hash_length")
    return raw[::-1].hex()


def normalize_compact(block) -> dict:
    return {
        "height": int(block.height),
        "hash": rpc_hex(block.hash),
        "prev_hash": rpc_hex(block.prevHash),
        # Providers can include transparent-only tx envelopes in CompactBlock.
        # The frozen projection explicitly retains shielded-relevant entries only.
        "txids": [rpc_hex(tx.txid) for tx in block.vtx
                  if any(getattr(tx, field, ()) for field in ("spends", "outputs", "actions", "ironwoodActions"))],
    }


class CompactGrpcAdapter:
    def __init__(self, endpoint: str):
        # Generated bindings must be supplied in PYTHONPATH by the isolated runner.
        import grpc
        import service_pb2
        import service_pb2_grpc

        parts = urlsplit(endpoint)
        if parts.scheme not in {"grpc", "grpcs"} or not parts.hostname or not parts.port:
            raise BenchmarkError("invalid_grpc_endpoint")
        if parts.username or parts.password or parts.query or parts.fragment or parts.path:
            raise BenchmarkError("grpc_endpoint_must_not_contain_secrets_or_path")
        target = parts.netloc
        opts = [("grpc.max_receive_message_length", 16 * 1024 * 1024)]
        self.channel = (grpc.secure_channel(target, grpc.ssl_channel_credentials(), options=opts)
                        if parts.scheme == "grpcs" else grpc.insecure_channel(target, options=opts))
        self.stub = service_pb2_grpc.CompactTxStreamerStub(self.channel)
        self.grpc = grpc
        self.pb = service_pb2
        self.request_count = 0
        self.server_info = {}
        self.payload_bytes = 0

    @staticmethod
    def remaining(deadline):
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise DeadlineExceeded("grpc_deadline_exceeded")
        return seconds

    def check_source(self, manifest, deadline):
        if manifest["projection"] != "shielded_compact":
            raise BenchmarkError("compact_adapter_requires_explicit_projection")
        self.request_count += 1
        try:
            info = self.stub.GetLightdInfo(self.pb.Empty(), timeout=self.remaining(deadline))
        except self.grpc.RpcError as exc:
            self._raise_rpc_error(exc)
        self.server_info = {k: getattr(info, k) for k in ("version", "vendor", "gitCommit", "chainName", "blockHeight")}
        aliases = {"regtest": {"regtest", "test"}, "testnet": {"test", "testnet"}, "mainnet": {"main", "mainnet"}}
        if info.chainName.lower() not in aliases.get(manifest["network"], {manifest["network"]}):
            raise BenchmarkError("source_network_mismatch")
        if manifest["start_height"] != 1:
            raise BenchmarkError("regtest_profile_requires_genesis_link_from_height_one")
        self.request_count += 1
        try:
            # LWD v0.5.5 rejects height zero. Both providers can instead prove
            # the genesis boundary through height one's parent hash.
            block = self.stub.GetBlock(self.pb.BlockID(height=1), timeout=self.remaining(deadline))
        except self.grpc.RpcError as exc:
            self._raise_rpc_error(exc)
        if block.height != 1 or rpc_hex(block.prevHash) != manifest["genesis_hash"] or rpc_hex(block.hash) != manifest["start_hash"]:
            raise BenchmarkError("source_genesis_mismatch")
        if int(info.blockHeight) < manifest["end_height"]:
            raise BenchmarkError("source_not_caught_up")

    def read_blocks(self, start, end, deadline):
        self.request_count += 1
        request = self.pb.BlockRange(start=self.pb.BlockID(height=start), end=self.pb.BlockID(height=end))
        stream = self.stub.GetBlockRange(request, timeout=self.remaining(deadline))
        try:
            for block in stream:
                self.remaining(deadline)
                self.payload_bytes += block.ByteSize()
                yield normalize_compact(block)
        except self.grpc.RpcError as exc:
            self._raise_rpc_error(exc)
        finally:
            stream.cancel()

    def _raise_rpc_error(self, exc):
        if exc.code() == self.grpc.StatusCode.DEADLINE_EXCEEDED:
            raise DeadlineExceeded("grpc_deadline_exceeded") from None
        raise BenchmarkError("grpc_request_failed") from None

    def close(self):
        self.channel.close()
