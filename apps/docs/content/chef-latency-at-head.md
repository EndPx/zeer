# Latency at the chain head

At the head, the question is how long a new source block takes to become queryable. Historical blocks per second measure a different workload.

## Follow the whole path

| Stage | What to observe |
| --- | --- |
| Zcash source | The configured node observes a block and its hash |
| Prep | `/height` reports the block as indexed and queries can return it |
| Chef | The handler's entities and checkpoint commit to PostgreSQL |
| GraphQL | Your reader first observes that committed checkpoint and entity |

A low query response time does not prove a short delay across those stages. Block timestamps also do not tell you exactly when your node received a block. Record observation times on one clock, or synchronize clocks when measuring across hosts.

## Start near the available head

Guided `zeer init` defaults to `latest`: it captures Prep's available indexed height once and writes that number into `chef.config.ts`. This avoids replaying all historical blocks for a new application. It does not backfill older activity. Choose `0` or another explicit height when your application needs history.

After installation, database configuration and migration, run separate terminals:

```sh
pnpm run follow
```

```sh
pnpm run serve
```

Inspect progress with:

```sh
pnpm run status --json
```

With npm, use `npm run status -- --json`. Read the [CLI reference](/docs/chef/cli-commands/) for direct invocation and output flags.

## Read the two gaps separately

| Observation | Meaning |
| --- | --- |
| `source.prepSourceLagBlocks` | Source-observed height minus Prep's indexed height, when follower metadata is available |
| `source.chefPrepLagBlocks` | Blocks still to commit from this project's next block through Prep's indexed height |
| `source.sourceObservedAt` | Time of the reported source observation; check its age |
| `checkpoint.height`, `checkpoint.status` | Durable project progress and whether reads are ready, reconciling or blocked |

A zero Chef–Prep gap means caught up with the observed Prep data. It does not prove Prep has the newest network block. A historical snapshot has no current source-tip guarantee, and unavailable source metadata must remain unknown rather than zero.

## Tune the delay you measured

Chef polls every **5 seconds** while following by default. You can test a shorter interval:

```sh
pnpm run follow --poll-seconds 1
```

The supported interval is 1–60 seconds. Polling more often can reduce the waiting component of detection while increasing request load. It cannot make Prep publish blocks before ingestion or make a database commit instantaneous. Source polling, confirmation depth, handler work, commit size and your application's own polling also affect the observed delay.

For a new block, record its height and hash when the source is observed, when Prep returns it, when Chef commits it and when GraphQL first returns the expected entity. Repeat across several blocks and publish sample count, median and tail delays in seconds. Client polling gives an observation bound, not an exact server publication time.

## Confirmations and reorgs

Fresh data can still be reorganized. Chef reconciles supported chain changes behind its read gate; a checkpoint can become blocked when recovery cannot prove a retained ancestor. Follow [checkpoint and reorg handling](/docs/chef/recovery/) rather than resetting the namespace to make it appear ready.

Applications such as payment observers must recheck their required confirmations and source canonicality before settlement. Private scanner work adds a separate processing stage. The public block-summary [recorded benchmark](/docs/chef/benchmarks/) does not measure note decryption or establish a chain-head latency SLA.

## Recorded polling experiment

On 21 October 2026, three separate 12-block paired studies compared Chef 0.1.3's 5-second polling with 1-second and 2-second candidates. Shorter intervals reduced median source-to-GraphQL latency, but every study still observed temporary 503 read gates. None passed the predeclared availability criterion, so polling defaults and production services remained unchanged.

An extra Prep observer affected capacity in the first study. Without that observer, writer-derived Prep timestamps include polling detection delay and cannot isolate source publication latency. See the [live following results and limits](/docs/chef/benchmarks/#live-update-delay-polling-experiment) for timings in seconds, tail observations, correctness checks and raw evidence.
