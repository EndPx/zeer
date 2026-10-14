# Zeer benchmark harness

This repository contains source, methodology, pinned candidates and public input
fixtures for Prep retrieval, Chef application indexing and native serving comparisons.

## Local results policy

All generated benchmark results stay local. Store raw runs, logs, comparison
tables, reports and execution manifests under `benchmarks/results/`, which is
ignored by Git. Do not force-add that directory or copy measured results into
public READMEs, plans or candidate manifests. Publication requires a new explicit
request from the project owner. This storage policy does not change where an
authorized experiment runs; remote working copies remain operational state.

A fresh checkout has no result directory; create it when starting an experiment.
Keep failures and successful runs together locally. Commit source, configuration,
methodology and deterministic public-chain input fixtures needed to reproduce tests.
The [public mainnet oracle](fixtures/mainnet-public-2048/README.md) is an input
fixture, not a performance result.

- [Benchmark specification](../docs/BENCHMARK_SPEC.md)
- [Public transaction lookup harness](transactions/README.md)
- [Prep full-data verification](prep/full/README.md)
- [Chef workload and reproduction](../docs/CHEF_BENCHMARK_PREFLIGHT.md)
- [Candidate preflight](docs/CANDIDATE_PREFLIGHT.md) and [source pins](manifests/candidates.json)

## Local harness tests

Python 3.12+ is sufficient for the stdlib harness and normalization unit tests:

```sh
python -m unittest discover -s benchmarks/tests -v
python -m benchmarks.runner --help
```

The optional gRPC adapter requires the versions in `requirements-grpc.txt` and generated protobuf modules on `PYTHONPATH`. The reference container keeps these dependencies outside the source checkout.

## Reproduce on an isolated Linux Docker host

Use a fresh checkout, adequate free disk, and an isolated state directory. This experiment's authorized operational envelope was 2 aggregate CPU, 4 GiB aggregate process memory, and 10 GiB total incremental disk. Docker image pulls and host services have additional shared overhead. CPU quotas are not dedicated CPU cores. Inspect disk and host load before each stage; stop the benchmark if incremental disk reaches 10 GiB, available host RAM drops below 2 GiB, or other service health degrades. Do not stop unrelated services or prune global Docker storage.

The compose topology below is a reproducible encoding of the measured containers. Validate it with `docker compose config` before execution. The original run used equivalent explicit `docker run` commands; exact container identities/configuration are preserved in each result's environment evidence.

From the repository root:

```sh
export ZEER_BENCH_STATE="$(pwd)/.deploy-local/benchmark-runtime"
mkdir -p "$ZEER_BENCH_STATE"/client/generated "$ZEER_BENCH_STATE"/results "$ZEER_BENCH_STATE"/zaino
# Zaino's pinned image runs as UID/GID 1000; prepare only this dedicated directory.
sudo chown 1000:1000 "$ZEER_BENCH_STATE/zaino"

docker compose -f benchmarks/infra/compose.yaml config --quiet
docker compose -f benchmarks/infra/compose.yaml up -d zebra
docker compose -f benchmarks/infra/compose.yaml --profile tools run --rm client sh -c \
  'python -m pip install --no-cache-dir --target /client/deps -r benchmarks/requirements-grpc.txt && python -m grpc_tools.protoc -I benchmarks/proto --python_out=/client/generated --grpc_python_out=/client/generated benchmarks/proto/compact_formats.proto benchmarks/proto/service.proto'
```

Wait for Zebra RPC to respond at `127.0.0.1:39232` with the expected regtest genesis. Replay the exact archived blocks rather than generating different timestamp/hash data:

```sh
docker compose -f benchmarks/infra/compose.yaml --profile tools run --rm client \
  python -m benchmarks.scripts.replay_regtest --endpoint http://zebra:18232 \
  --archive /work/benchmarks/fixtures/regtest-1024/blocks.jsonl.gz \
  --metadata /work/benchmarks/fixtures/regtest-1024/blocks.jsonl.gz.manifest.json
```

The replay checks the archive checksum, genesis, every height/hash and the resulting tip. It can resume a matching prefix, refuses a conflicting chain and never deletes existing data. `prepare_regtest.py` creates a **new** disposable fixture and therefore must not be substituted when reproducing these fixture hashes.

Start exactly one provider, wait for its startup/catch-up, and capture the sanitized host evidence **before** starting the client:

```sh
docker compose -f benchmarks/infra/compose.yaml --profile lightwalletd up -d lightwalletd
python3 benchmarks/scripts/capture_environment.py --output "$ZEER_BENCH_STATE/results/environment-lightwalletd.json"
docker compose -f benchmarks/infra/compose.yaml --profile tools run --rm client \
  python -m benchmarks.scripts.run_compact --endpoint grpc://lightwalletd:9067 \
  --manifest /work/benchmarks/fixtures/regtest-1024/regtest-shielded_compact.json \
  --candidate lightwalletd --version v0.5.5 --client-cpus 1 \
  --environment /results/environment-lightwalletd.json --output /results/lightwalletd
```

Stop that provider before switching:

```sh
docker compose -f benchmarks/infra/compose.yaml --profile lightwalletd stop lightwalletd
docker compose -f benchmarks/infra/compose.yaml --profile zaino up -d zaino
python3 benchmarks/scripts/capture_environment.py --output "$ZEER_BENCH_STATE/results/environment-zaino.json"
docker compose -f benchmarks/infra/compose.yaml --profile tools run --rm client \
  python -m benchmarks.scripts.run_compact --endpoint grpc://zaino:8137 \
  --manifest /work/benchmarks/fixtures/regtest-1024/regtest-shielded_compact.json \
  --candidate zaino --version 0.10.1 --client-cpus 1 \
  --environment /results/environment-zaino.json --output /results/zaino
```

If source preflight is not ready, inspect provider logs and readiness before retrying; preserve the failed setup attempt separately. Do not turn it into a zero-throughput result. No unexpected benchmark failures should be silently discarded.

The environment capture is deliberately allowlisted: no host names, public IP addresses, other application names, Docker environment variables, or authentication material. It checks benchmark-labelled active quotas. Run only one experiment with this label per host. Container ports bind localhost; native gRPC is plaintext only within the private benchmark network.

Stop the selected benchmark project when finished, keeping its state for inspection:

```sh
docker compose -f benchmarks/infra/compose.yaml --profile lightwalletd --profile zaino stop
```

No global Docker cleanup command is part of this workflow.

## Interpretation

- The fixture has exactly one transparent coinbase transaction per block, no shielded actions and no private keys.
- Normalization compares height, block hash, parent hash and IDs of shielded-relevant compact transactions. The last list is empty in this live dataset.
- `GetBlock(0)` is not supported by the tested lightwalletd. The common preflight checks block 1 and its parent genesis hash instead.
- The read timer includes gRPC streaming, client decoding and normalization. It is **not server-only throughput**.
- Reports from different resource profiles cannot be pooled. Five passing repetitions establish a valid finite-workload sample, not a general speed ranking.
- The internal report field `eligible_for_comparison` means the required repeated correctness checks passed; external workload/environment comparability must still be assessed.
- The native deadline adapter stops subsequent runs on timeout. A generic Python adapter stuck beyond its deadline cannot be forcibly terminated inside a thread; the caller must end the candidate process before another experiment.

## Scope boundaries

Keep retrieval, application ingestion and authorized shielded scanning as separate
workloads. The current public-data implementation does not establish whole-chain
performance, private-note scanning or production readiness. See the active
[project plan](../plan.md) for implementation scope.
