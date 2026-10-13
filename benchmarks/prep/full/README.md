# Full-block verification and native-read observation

`verify.py` requires a frozen Zebra-compatible JSON-RPC source and a running
Prep HTTP archive containing mainnet blocks 1000â€“2023. Its allowlisted source
reads compare complete raw blocks and every decoded source field with Prep,
then validate transaction-ID and transparent-output filtering. JSON decimals
are read independently with Python Decimal while retaining the original source
token, including scientific notation and trailing zeros. A conversion such as
`str(Decimal('1e-6'))` would change the expected string into `0.000001` and create
a false mismatch. No spending or signing occurs.

```sh
export PREP_API_TOKEN='your-local-deployment-token'
python benchmarks/prep/full/verify.py \
  --source http://your-private-node:8232 \
  --prep http://127.0.0.1:39368 \
  --from-block 1000 --to-block 2024 --out /path/to/new-results
```

The script is for a trusted isolated benchmark network. The plaintext node URL
must have no credentials; the actual experiment uses private Docker networking
with no public Prep port. Do not point it at a changing or untrusted source.

The timed task projects only height/hash/time. The RPC side uses eight workers,
reused connections and known hashes; Prep uses pages of 128 blocks. Both normalize
the same final fields. It includes native transport/decoding work but excludes
initial node synchronization and Prep ingestion. This is not an isolated-engine
comparison or a benchmark of full transaction throughput. Preserve every run.

`live_smoke.py` is a separate **Regtest-only mutating test**: it checks the fixed
Regtest genesis and initial height 1024, then mines two disposable blocks using
`generate`. Use a private copy of the original
[1024-block fixture](../../fixtures/regtest-1024), never an application node.
The provided `zebra-regtest.toml` uses the same activation schedule and disables
seed discovery for an internal Docker network. Start `prep sync --follow` from
1020 with confirmations 1, segment size 2 and a finite rehearsal step limit; start
`prep serve-http` against that archive, then run:

```sh
python benchmarks/prep/full/live_smoke.py \
  --source http://your-private-regtest:18232 \
  --prep http://127.0.0.1:39368 --out /path/to/new-live-result.json
```

Its source checks precede mining. The assertion on initial height prevents an
accidental rerun against an already advanced fixture. Source growth must become
queryable while an old cursor retains its captured range. Reorgs are tested by
the Rust controlled-source suite rather than claimed from this two-block test.

The mainnet source and Regtest source image pins, process limits, binary and code
hashes are recorded in the [execution evidence](../../results/raw/2026-10-13-prep-full/execution.json).
See [the report](../../results/reports/2026-10-13-prep-full.md) for setup findings,
what was actually measured, and the limits of the resulting claims.

## Comparing Prep revisions

`compare.py` serves a different purpose: compare two release binaries against
the **same already prepared immutable archive**. Give each server the same CPU
and memory limits, use the same private Docker network, and stop ingestion while
measuring. No new Python dependencies are needed.

```sh
python -m unittest benchmarks.prep.full.test_compare -v
python benchmarks/prep/full/compare.py \
  --before http://prep-before:39368 --after http://prep-after:39368 \
  --from-block 1000 --to-block 5096 --runs 5 --out comparison.json
```

It tests headers, raw blocks, transaction metadata, full block/transaction
projections, a matching transaction ID, and a no-match version scan. Each case
warms both servers and alternates their order over all measured runs. The
reported duration sums request times through JSON decoding; ordered record
hashing and equivalence checks run **between requests, outside the timer**.
These durations are not uninterrupted wall-clock scan times. Record counts and
SHA-256 digests must match independently of page boundaries. The client releases
each page before the next request instead of retaining the entire dataset.

The benchmark never overwrites an existing output. Ordinary failures preserve
completed measurements with `FAIL`; an externally killed process may leave an
incomplete file. It is a regression comparison, not a consensus oracle. Use the
separate full-node verifier for source equality. Record the exact binaries,
archive identity, resource limits and any regressions; do not publish only the
fastest case.
