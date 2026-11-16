# Testnet resource envelope — 16 November to 16 December 2026

The operator approved a **10 GiB aggregate RAM envelope** with **7 GiB for
Zebra**, then requested capacity planning for the following month. The deployment
uses the existing VPS; this change does not provision a paid machine or disk.
Capacity estimates are separate from an uptime commitment and from application
financial readiness.

## Applied allocation

| Resource | Allocation or safety boundary |
| --- | --- |
| Aggregate CPU | 3 cores, enforced by the existing cgroup envelope |
| Aggregate RAM | 10 GiB: 10,048 MiB main slice plus 192 MiB bridge slice |
| Zebra RAM | 7 GiB; memory-plus-swap limit equals memory limit |
| Prep API RAM | 1,536 MiB |
| Prep writer RAM | 1,024 MiB |
| Prep archive storage | 40 GiB; append still reserves 268,435,456 bytes |
| Aggregate Zeer storage | 84 GiB; guard stops at 83 GiB |
| Node storage budget | 35 GiB; guard stops at 34 GiB, unchanged |
| Host physical free space | At least 25 GiB, unchanged |
| Host available memory | At least 3 GiB, unchanged |

Per-service CPU quotas are maxima within the aggregate limit, not simultaneous
reserved cores. The Prep API and writer each permit up to one core after measured
CPU saturation at their previous half-core limits. API requests and full-payload
archival share the existing total with node verification and other Zeer work.
Request concurrency, payload limits, canonicality checks and source timestamps
were not relaxed to increase capacity.

Kernel evidence showed Zebra OOM at both 4 GiB and 5 GiB. The previous API also
hit its 1 GiB cgroup limit. These were process/cgroup limits even while the host
had available RAM. The allocation above must still be assessed with actual
running observations; a higher limit is not evidence of indefinite stability.

## Thirty-day sizing basis

The usable historical interval is approximately **8.38 active days**, from the
28 October reclamation to the archived source observation on 5 November. The
subsequent approximately 9.9 stopped days are excluded: dividing by that idle
time would understate the live growth rate.

| Measured or planned quantity | Value |
| --- | ---: |
| Archive growth, including retained copies | 211.64 MiB/day |
| Node allocated-storage growth | 92.03 MiB/day |
| Growth multiplier for the projection | 2× |
| Additional database/log/other allowance | 2.25 GiB |
| Separate one-time allowance for already queued history | 1.50 GiB |
| Total projected growth and catch-up allowance | 21.54 GiB |
| Projected archive, including append reserve | 37.56 GiB |
| Projected aggregate Zeer storage | 81.22 GiB |
| Projected host free disk | 27.92 GiB |

The current-point measurements used by the model were about 23.91 GiB of archive
file bytes and 49.46 GiB of physical free disk. Unreferenced Docker images were
removed before sizing, while images used by retained containers, ZeeSwap images
and private data snapshots were preserved. This is physical headroom on the
existing filesystem, not newly purchased capacity.

The forecast uses one historical active interval, not a daily p95 distribution.
Network activity, new deployments and other applications can grow faster than
this allowance. Recompute the plan if the workload changes. The hard reserve
guards remain fail-closed; they do not silently expand allocations or delete
history. Retired archive copies still count toward the writer budget. No online
GC or automatic deletion of old reader paths was introduced.

## Bounded recovery

The Zebra, Prep writer and Prep API units now use `Restart=on-failure`, with a
60-second delay and at most three starts per hour. Intentional operator stops
remain stopped. A guard halt is not automatically cleared. Source-authentication,
network and archive integrity checks still run before following resumes.

The guard's I/O scheduling changed from `idle` to low-priority `best-effort`
with priority 7 after a real measurement timeout during startup load. Idle-I/O
starvation is a supported explanation, not an isolated reproduced fault. The
measurement deadline and resource thresholds remain enforced.

These are configuration and observation checks, not an injected-crash or reboot
test. A persistent error exhausts the retry allowance and requires diagnosis.
Financial workers and settlement supervision are not part of this retry policy.

## Read-only capacity diagnostics

[`tools/zeer_capacity_monitor.py`](../tools/zeer_capacity_monitor.py) runs as
`zeer-capacity-monitor.service`, scheduled five minutes after its previous run
finishes. A full archive walk can take time, so this is not an exact five-minute
sampling SLA. The service has a small CPU/memory envelope and a bounded runtime;
it neither repairs nor stops the source.

Operational files on this deployment:

```text
/opt/zeer-testnet/capacity-20261116/capacity-plan-30d.json
/opt/zeer-testnet/capacity-20261116/state/capacity-status.json
/opt/zeer-testnet/capacity-20261116/state/capacity-history.jsonl
```

History is limited to three 4-MiB files. Diagnostics warn about fewer than 14 days
of storage margin at the planned growth rate, source/follower process failures,
unknown or stale observations, host available RAM below 4 GiB, and node RSS at or
above 6 GiB. The 30-day horizon also expires explicitly. Missing measurements are
unknown, never fabricated zero usage.

Process states and source clocks are sampled after slow archive I/O. A recent
error-status write cannot establish a fresh source observation. Diagnostic
sampling time is never substituted for the writer's original timestamp, and
diagnostics do not modify `status.json`, project data, keys or financial state.

```sh
systemctl status zeer-capacity-monitor.timer
journalctl -u zeer-capacity-monitor.service -n 20 --no-pager
cat /opt/zeer-testnet/capacity-20261116/state/capacity-status.json
```

The monitor produces local status and journal records, not external notifications.
Its tests cover early warnings, unknown/stale/error states, horizon expiry,
post-I/O sampling clocks, preservation of source status and bounded log rotation.

## Consumer transport and readiness

Backend CPU saturation and public ingress are distinct. Increasing API CPU
removed most native admission rejections in the observed cohort, but the private
consumer could still burst above the public two-requests-per-second boundary.
The separately reviewed ZeeSwap wrapper supports a pinned one-second dispatch
interval through PrepClient's existing fetch seam. It does not add retries,
cache results, substitute source metadata or change the project fingerprint.
Its deployment and live qualification are recorded with the consumer's evidence.

A queryable `ready` checkpoint may still be far behind Prep. Source readiness,
Zebra's estimated network-sync gap, consumer backlog and financial readiness must
be reported independently. Resource sizing does not authorize payout or reopen
application admission.

## Deployment provenance and preservation checks

This recovery changes resource configuration, local diagnostics and the private
consumer transport. It does not publish a new Prep or Chef SDK release.

| Component | Verified deployed identity |
| --- | --- |
| Writer | `prep 0.1.0`, clean build commit `63331816537545f0d059d61a2f453fcabeb6a1b8` |
| Writer executable SHA-256 | `81f34e6c34f7e62f52671fb506c8bbe3c229e96fad0ce5c8ca7d6ffe97550a1d` |
| Reader executable SHA-256 | `d788ea8b25216b4e0fe21b3336bf4955fa670f890a764ca6adab91da6758c414` |
| Zebra image digest | `4496df7553bd5449eb40e4d1d7537356ae765105a8447ad0bdec1f365197e905` |
| Private consumer wrapper commit | `6cd5a59` in the ZeeSwap repository |
| Consumer runtime SHA-256 | `292100112e1fcf650d62222a24e1fd0e2088d3329f9aa6afd9ae3850403b63fa` |
| Chef SDK | `0.7.0`, unchanged |

The running `/proc` executables were checked against those hashes. Independent
read-only checks verified the original key/account material and metadata hashes,
project generation, anchor and existing entity rows. The checkpoint hash matched
Prep. A second writer-lock acquisition was refused while normal following ran.
The API container identity and start time remained unchanged; the follower process
was recreated for the reviewed transport image, retaining its original database.

The finite source-only repair completed one block before a separately reviewed
normal-mode handoff. Normal pins have no recovery object and recovery is disabled.
The exact financial baseline remained unchanged, with financial supervision
explicitly paused until the application completes its own qualification.

The diagnostic utility passed eight focused tests. The private wrapper passed
39 runtime tests, including cancellation, unchanged source packets/errors and
unchanged project identity through the real installed PrepClient. These checks
are distinct from the live observation and from month-long reliability.

## Observed recovery result

The final paced cohort passed its bounded qualification on 16 November at
10:44 UTC (17:44 WIB). Over **900.02 seconds**, all **91/91** source/status
samples were ready and available, and **16/16** GraphQL probes read a ready
checkpoint. The consumer advanced **225 blocks**, from 4,587,611 to 4,587,836,
with zero follower restarts and zero Prep OOM kills. Zebra had remained running
for approximately **100 minutes** without another OOM; its sampled RSS peak in
this final cohort was **3,865,165,824 bytes**.

Earlier cohorts are retained separately: the half-core API produced 29 HTTP 429
responses in 93 native probes; the one-core API without follower pacing produced
one in 86, while the consumer ready fraction was only 23.26%. These are different
live windows, not a controlled engine benchmark or pooled latency study. Final
native height-probe median was **0.0870 seconds**, with nearest-rank p95
**0.2434 seconds**; these are successful readiness probes, not shielded-receipt
latency or public internet performance.

The subsequent independent check saw Prep at **4,626,029** against an actually
observed source height of **4,626,030**. Chef was ready at **4,587,840**, leaving
**38,189 blocks** of archived backlog. The queryable prefix was restored; the
consumer was **not caught up**. Neither the local source tip nor its network-sync
estimate is an independent consensus or global-network-head attestation.

The capacity observation near that check recorded **50,887,094,272 bytes** of
physical free disk, **7,789,191,168 bytes** of host available RAM,
**66,271,082,082 bytes** of aggregate Zeer storage and **26,501,463,405 bytes** of
archive files. The resource guard passed and capacity diagnostics had no warnings.
These are timestamped observations; the sizing-point forecast above uses its
own earlier baseline and is not silently rebased onto this later snapshot.

The [sanitized operation artifact](https://zeer.endpx.cloud/docs/operations/2026-11-16-capacity-recovery.json)
contains the sizing inputs, all three cohorts, final preservation checks and
deployed hashes. Recalculate its arithmetic and acceptance with:

```sh
python tools/verify_resource_capacity_20261116.py
```

No archive history, project, birthday, key or account was reset. Financial
supervision remains paused for the application's separate catch-up and
qualification. A 15-minute observation and a 30-day capacity estimate do not
prove month-long execution, a recovery-time guarantee, or a production SLA.

## Later canonical replay and full Chef catch-up

The private ZeeSwap Chef follower completed its archived backlog and then passed
a separate live-follow observation at **14:43 UTC (21:43 WIB) on 16 November**.
The earlier 15-minute resource observation above remains a historical result;
the later convergence evidence is a separate cohort.

| Final observation | Verified result |
| --- | ---: |
| First actual caught-up checkpoint | 4,627,146 |
| Checkpoint after live following | 4,627,177 |
| Prep indexed height at that observation | 4,627,177 |
| Live-follow window | 305.02 seconds |
| Blocks processed after first caught-up observation | 31 |
| Ready sample fraction during qualification | 100.00% |
| Sample fraction within zero or one Prep block | 95.16% |
| Follower peak memory in the final cohort | 147,451,904 bytes |
| Follower memory ceiling | 536,870,912 bytes |
| Unplanned follower restarts / OOM kills | 0 / 0 |

An epoch conflict had latched the reorg read gate while the original follower
was far behind the archive. Its retained checkpoint and 201 retained headers
already matched Prep. The operator captured a namespace backup, verified that
history, and used the original SDK's finite replay to clear the reconciliation
gate. Readiness was never changed through a direct SQL update. Brief burst gaps
of two or three blocks occurred before the qualifying window met its original
near-head threshold; the full observation history is retained.

The private wrapper now uses an explicitly pinned execution profile with maximum
page, batch and payload bounds of 64 and 0.6-second request spacing. This changes
effective execution while retaining the original config bytes, schema, handlers,
project identity, birthday, account and viewing key. Actual typed HTTP 413 responses
reduce a request-bound hint; eight full successful raw pages permit one cautious
growth trial. Header and source-height data are never cached by this policy.
The server's deployed 8-MiB response ceiling and the client's 32-MiB body guard
remain unchanged. Chef SDK version 0.7.0 and the API process remain unchanged.

Before promotion, 53 deployment tests, 12 existing indexer tests and TypeScript
checking passed. Eight actual PostgreSQL checks in a disposable database verified
atomic failure/interruption rollback, batch-one/64 equivalence, per-block undo,
replacement replay and writer exclusion. The test database, restricted role and
temporary credentials were removed. Native scanner canaries then processed real
testnet transactions under the existing 512-MiB / 0.5-CPU follower envelope.

The final independent check compared **201 retained headers**
with Prep and checked the checkpoint hash through the actual Zebra RPC. All
5 original entity rows were preserved; the original
generation, namespace, key/account material, anchor, source URL and scanner were
unchanged. One normal writer held the advisory lock. Financial books remained
unchanged and supervision stayed paused for the application's separate
qualification. This is a bounded testnet operational result, with local-node
trust and future-reorg limits; it is not a month-long uptime or mainnet claim.

The [canonical catch-up artifact](https://zeer.endpx.cloud/docs/operations/2026-11-16-chef-caught-up.json)
records the separate cohorts, real canaries, preservation checks and hashes.
The [consumer implementation and operator evidence](https://github.com/EndPx/ZeeSwap/blob/main/docs/evidence/chef-canonical-reorg-catchup.md)
describe the private wrapper and its canonical-replay boundaries. Installing
the published Chef package does not enable this private deployment profile.
