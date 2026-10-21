# Live source-to-GraphQL latency

This bounded test follows new Zcash Testnet blocks with two Chef 0.1.3 writers.
Both process the same blocks into the same schema on the same PostgreSQL server.
The single comparison factor is the follow polling interval: **5 seconds versus
1 second**, or a separately declared **2-second** candidate. Actor assignments
cross over after half the samples.

It is a live service observation, not a repeatable historical throughput ranking,
a measurement of block production or an SLA. It does not decrypt shielded notes.
Public Sapling, Orchard and Ironwood density is counted from the source reference.

## Run

Use Linux/WSL, Node 24.14+, a synchronized private-IP Zebra RPC endpoint, a ready
full-data testnet Prep service and a **separate disposable PostgreSQL database**.
Do not point the experiment at an existing application database. Its role needs
permission to create its own schemas, not superuser privileges.

Copy `run.mjs`, `worker.mjs`, `common.mjs` and `database.mjs` into a fresh consumer directory so
module resolution uses the intended published packages rather than a workspace:

```sh
npm init -y
npm install @zeer-dev/chef@0.1.3 @zeer-dev/prep-client@0.1.0 pg@8.23.1
```

Set `PREP_URL`, optional `PREP_API_TOKEN`, the experiment's `DATABASE_URL`, a random
`CHEF_API_TOKEN` of at least 16 bytes and credential-free `BENCH_RPC_URL` locally.
Keep credentials out of arguments and tracked files. The RPC cookie stays in a
protected local file; only literal private/loopback IPv4 RPC hosts are accepted.
RPC redirects are rejected. Apply a shared CPU/memory quota to the observer and
all its children before running.

```sh
node run.mjs --out-dir /new/experiment/results \
  --rpc-cookie-file /protected/zebra.cookie \
  --samples 12 --deadline-seconds 1500 --prep-observer-seconds 0.5
```

The result directory must not exist. The run writes its plan and source hashes
before creating actors or collecting samples. It never overwrites a namespace
or drops a database. Preserve a failed result; use a new directory for another
attempt. Operator cleanup must target only the recorded experiment-owned database.

To test the extra observer's effect, use a separate trial and new namespaces:

```sh
node run.mjs --out-dir /new/experiment/observer-disabled \
  --rpc-cookie-file /protected/zebra.cookie \
  --samples 12 --deadline-seconds 1500 --prep-observer-seconds 0
```

The flag accepts 0, 0.5, 1 or 2 seconds; 0 disables periodic Prep checks. Both
studies keep the same paired 5/1-second writer comparison and acceptance rules.
Do not pool their samples or stage summaries: removing observer traffic changes
the load and the meaning of the earliest Prep observation.

After a faster candidate fails the availability criterion, test the bounded
2-second alternative in a new trial without changing the acceptance rules:

```sh
node run.mjs --out-dir /new/experiment/two-second-candidate \
  --rpc-cookie-file /protected/zebra.cookie --samples 12 \
  --deadline-seconds 1500 --prep-observer-seconds 0 --candidate-poll-seconds 2
```

`--candidate-poll-seconds` accepts 1 (default) or 2. Retain the rejected 1-second
results alongside the later candidate; choosing a new trial is not permission
to drop failures or pool results across changing source blocks.

## What gets measured

| Boundary | Timestamp |
| --- | --- |
| Source observed | Completion of the first local Zebra tip RPC reporting that height |
| Prep observed | Earliest successful matching header response, from the observer or either writer |
| Commit acknowledged | The writer's ordinary `applyBatch()` promise resolves after PostgreSQL commit acknowledgement |
| GraphQL observed | First completed coherent response containing the expected block hash and full transaction count |

The observer and children use the same host's `process.hrtime.bigint()` clock;
IPC messages check that their timestamps lie within the parent's monotonic run.
Source and GraphQL polling target 0.25 seconds. With the default setting, the
independent Prep check targets 0.5 seconds. With `--prep-observer-seconds 0`,
`prep_ns` comes only from a successful writer read and includes writer detection
delay; it cannot independently isolate Prep publication latency. Actual requests
can take longer under load. Raw request start
and completion times remain available. `source_lower_ns` is the previous tip
request's **start**, a conservative arrival bound. Block timestamps are not used
as latency clocks.

Prep responses may precede the observer's first source response. Negative stage
observations are preserved rather than clamped. Commit acknowledgement is not
the exact PostgreSQL flush instant; GraphQL visibility may overlap that boundary.
Use source-to-GraphQL and paired differences as the primary observed latencies.

The writer wrapper timestamps responses and commit acknowledgements without
changing handlers, database transactions, source validation or read gates. Both
actors receive the same instrumentation. Prep 429 responses and GraphQL 503 read
gates are recorded. A measurement waits for a valid successful response; it does
not replace a gated result with stale data. Finite verification commands alone
can retry 429/503 up to five attempts, with every retry recorded outside live
timing. Other failures terminate the run and preserve partial evidence.

## Exact data and restart checks

Each block produces a `BlockSummary`; each transaction produces `TransactionMeta`.
A cumulative `Totals` entity independently exposes duplicate handler application.
Writers start at the same captured Prep height. Bootstrap is excluded from live
latency. Each phase records the next predeclared six source heights for 12 samples.
There is no selection based on which actor wins.

After each phase, each actor is stopped once gracefully or with SIGKILL, with the
roles reversed in the next phase. These stops occur after acknowledged committed
data, not at a deliberately injected internal SQL boundary. A direct read-only
repeatable-read database snapshot records all entity data and the height/hash
even if a source failure has closed the API read gate. A compatible finite restart
must process zero blocks and preserve that data/checkpoint; read-gate recovery is
reported separately.

Direct PostgreSQL verification has connection, query and server statement limits
of at most five seconds, further capped by the remaining experiment deadline.
Each operation recomputes its remaining budget and closes its client on failure.

After both phases, a third fresh namespace replays the same complete range. All
three entity sets, cumulative totals and checkpoint hashes must match independently
decoded Zebra blocks. Boundary hashes are rechecked. GraphQL then exports every
entity from each stable namespace for the final comparison. This is source-observed
canonicality at verification time, not a guarantee against future reorgs.

The run keeps all samples, nearest-rank p95 values, request records, CPU/cgroup
memory and observer failures. The candidate is accepted only when the full paired
sample goal and exact/restart checks pass, median Prep-to-GraphQL is at most 80%
of baseline, source-to-GraphQL p95 does not increase, and timed GraphQL probes have
no errors. A completed experiment can pass correctness while rejecting the proposed
polling change. Small live samples do not establish a production latency target.

```sh
node --test benchmarks/chef/head/head.test.mjs
```

The unit checks cover independent projection, percentile arithmetic, mismatched
branches, credential-host validation and containment of IPC failures. They are
not substitutes for the live results, restart and clean replay checks.
