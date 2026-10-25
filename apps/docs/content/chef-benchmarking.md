# Benchmark your indexer

Measure a fixed job, find where time goes, change one thing and verify the results. Keep historical throughput, chain-head latency and GraphQL response time as separate measurements.

## 1. Freeze the job

Record the network, inclusive start/end heights and boundary hashes. Choose a range with real matches for the filters you use. Keep the same schema, handlers, source projection, PostgreSQL settings and resource limits between candidates.

For historical throughput, initialize each candidate with an explicit start height and a fresh project namespace. The interactive `latest` default is useful for starting near the head, but moving start heights cannot define a repeatable historical comparison. Initialization does not erase an existing project.

After installing dependencies and configuring `.env`, generate types, typecheck and explicitly migrate. Capture a finite replay as JSON lines:

```sh
pnpm run --silent sync --to 4522799 --json > sync.jsonl
```

This example assumes a fresh project starting at 4522544 and source coverage through 4522799. With npm, use `npm run --silent sync -- --to 4522799 --json`. A resumed run measures only the remaining work; do not present it as a fresh replay.

## 2. Read the completed-work metrics

Successful progress records identify their scope as `completed_pages`. The final record contains the invocation's accumulated completed-page counters and the durable checkpoint.

| Field | Interpretation |
| --- | --- |
| `blocks`, `transactions` | Completed-page work in this invocation; filtered transaction counts are matching inputs, not all chain transactions |
| `elapsedMs` | Invocation wall time, starting after config loading and writer acquisition; divide by 1,000 for seconds |
| `fetchMs` | Time inside measured Prep fetch operations; divide by 1,000 |
| `handlerIncludingEntityIoMs` | Handler execution including entity I/O waits; divide by 1,000 |
| `transactionOverheadMs` | Measured application-transaction duration outside handlers; divide by 1,000 |
| `prepRequests` | Prep calls counted by this invocation, including control reads |
| `checkpoint.height`, `checkpoint.hash` | Committed progress; verify independently against the source |

The raw JSON field names preserve the CLI's existing format. Present durations in seconds in reports. This is not a full CPU profiler: preparation, private scanner work and uninstrumented overhead are not individually attributed. `transactionOverheadMs` is not a pure PostgreSQL-write timer. A partial or interrupted page can leave a durable prefix beyond the completed-page counters; inspect the checkpoint before interpreting totals.

Chef **0.7.0** also emits `state: "heartbeat"` during a long page. Its counters retain `metricsScope: "completed_pages"`; do not sum heartbeat rows or count them as newly completed work. The cached `progress` object identifies the pending inclusive range and last acknowledged/observed committed height. `heartbeatAt` shows that the process produced a diagnostic; `lastProgressAt` records a completed local stage and can change without a new commit. Neither field provides an exact scanner duration. See [recovery and progress semantics](/docs/chef/recovery/#read-long-running-work-in-chef-070).

For example, save this as `report.mjs` and run `node report.mjs`:

```js
import {readFile} from 'node:fs/promises';
const rows = (await readFile('sync.jsonl', 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
const last = rows.at(-1);
if (last?.state !== 'complete' || last.metricsScope !== 'completed_pages') {
  throw new Error('No completed finite replay; inspect the run and checkpoint');
}
console.log({
  blocks: last.blocks,
  transactions: last.transactions,
  elapsedSeconds: last.elapsedMs / 1000,
  fetchSeconds: last.fetchMs / 1000,
  handlerAndEntityIoSeconds: last.handlerIncludingEntityIoMs / 1000,
  transactionOverheadSeconds: last.transactionOverheadMs / 1000,
  prepRequests: last.prepRequests,
  checkpoint: last.checkpoint,
});
```

## 3. Test the suspected bottleneck

| Observation | Next comparison |
| --- | --- |
| Prep fetching is expensive | Metadata versus decoded input, matching public filters, fixed versus supported adaptive scans |
| Handler/entity-I/O time dominates | Required entity reads and writes, repeated computation, unnecessary external calls |
| Transaction overhead is high | Bounded commit groups and database latency, with the same durability settings |
| GraphQL is slow | Query plans, equality indexes, selected fields and page sizes |
| Throughput is low only after catching up | Measure [head latency](/docs/chef/latency-at-head/); new-block arrival now limits work |

Use [Database performance](/docs/chef/database-performance/) for schema and write-path choices. Chef's existing CLI reports JSON/human output; it does not currently expose an Envio-compatible Prometheus metrics endpoint or `zeer metrics` command.

## 4. Prove the change worked

Compare all expected entities and checkpoint hashes, then restart the compatible project and verify that completed work is not duplicated. Keep GraphQL reads active during indexing when that reflects the application. Report query latency and errors alongside throughput so an optimization cannot hide degraded reads.

Run at least three repetitions per candidate, alternate their order and report medians in seconds. Disclose warmups, cache state, resource ceilings, active background work, selected fields, result counts and source preparation costs. Preserve failures and raw samples. Keep one-time startup observations separate from steady head latency.

See [recorded Chef results](/docs/chef/benchmarks/) for durable entity indexing and [Prep results](/docs/prep/benchmarks/) for public-data retrieval. They measure different jobs and must not share a headline performance number.

## Measure shielded receipt processing separately

Keep the viewing key and raw private results in the operator's environment. Use an explicitly authorized testnet account, record its wallet birthday and scanner version privately, and define the expected receipt identities before comparing candidates. Do not infer receipt latency from public block-summary throughput.

Record monotonic observation boundaries for source block availability, the first matching Prep response, local scan completion, PostgreSQL commit acknowledgement and consumer storage. Synchronize clocks for stages on different hosts. Report sample count, median and tail latency in seconds, backlog, errors, active GraphQL query success/latency and CPU/memory limits. Separate catch-up samples from blocks mined after the observer was ready; report mining and confirmation waiting separately from receipt processing.

Compare a fixed range and unchanged model using the existing `sync.pageSize` and `sync.batchSize` controls before adding concurrency. Validate receipt identities, exact values and checkpoint hashes, then run the [interruption and restart exercise](/docs/chef/recovery/#recover-from-a-source-interruption). A larger batch holds an application transaction longer; a failed batch is rescanned and replayed. Phase heartbeats help locate a long stage but are sampled diagnostics, not a substitute for stage instrumentation or new benchmark evidence.
