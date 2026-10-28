# Prep archive-budget recovery — 28 October 2026

The testnet writer stopped at block **4,550,242** on 28 October at 14:56:05 WIB
with `archive_disk_budget_exhausted`. The configured archive budget was exhausted
by active data plus retained copies and the append reserve; the VPS disk was not
physically full. This is separate from the previous catalog-reference incident.

Final acceptance at **28 October 2026, 18:36:43 WIB**:

| Observation | Result |
| --- | --- |
| Prep indexed/source height | 4,550,764 / 4,550,764 |
| Prep readiness and observation age | `true`; 0.715 seconds |
| Chef checkpoint / GraphQL | 4,550,762; `ready`, authenticated GraphQL succeeded |
| Consumer lag at this snapshot | 2 blocks; a ready prefix does not guarantee zero lag |
| Archive regular-file bytes | 23,389,403,740 |
| Archive budget after explicit user approval | 27,917,287,424 bytes (26 GiB) |
| Headroom after 268,435,456-byte append reserve | 4,259,448,228 bytes |
| Shared deployment limits | 3 CPU / 8 GiB / 64 GiB; stop at 63 GiB |
| Minimum physical free disk | 25 GiB, unchanged |
| Consumer identity and containers | Project/generation/anchor, IDs/start times/restart counts unchanged |

The consumer was observed ready before and after the separately approved budget
restart. Its first recovery snapshot was at block
4,550,281 while Prep was at
4,550,700; that earlier result did not imply catch-up.
The final snapshot above records the later state explicitly. No wallet, signer,
settlement worker, financial database, Envio projection, key/account, birthday,
schema or consumer generation was changed by the Prep recovery.

## Proven cause

The failed writer uses `--max-disk-gib 24`. Its pre-append check counts all regular
files recursively, including retired files, and requires another 268,435,456
bytes of reserve. The pinned stopped archive contained:

| Category | Bytes |
| --- | ---: |
| Active referenced segment directories | 23,296,016,108 |
| Candidate retired copies, before comparison | 2,152,987,836 |
| Previously classified 79 retained directories | 1,939,780 |
| Other archive files, including legacy metadata/catalog/status | 81,437,617 |
| **Total** | **25,532,381,341** |
| Configured 24 GiB budget | 25,769,803,776 |
| Remaining bytes before append reserve | 237,422,435 |
| **Deficit after append reserve** | **31,013,021** |

The catalog had 16,146 references, 8,341,755 bytes, epoch 243 and revision
35,533. Neither the 30,000-reference nor 16 MiB catalog cap was hit. The last
consolidation had completed, but replacement outputs retain their source files
for lazy old readers. Compression/consolidation alone therefore did not reclaim
the accumulated bytes. No incomplete segment or new above-head unpublished
output from this pre-append failure was found.

The 79 original directories were protected throughout. Their historical
classification from the preceding incident was 75 branches, three canonical
duplicates and one completed unpublished output above that incident's old head.
That last directory is now below the current head; it was not silently removed.

## Lossless reclamation and reader protection

The new read-only verifier pinned the catalog and candidate file hashes, held the
writer lock, opened integrity-checked stores and compared complete `BlockRecord`
values, including payload bytes. Matching block hashes alone were insufficient.

- 19,197 candidates examined; **59,214 record comparisons**, including overlapping
  copies and first mismatches. This is not a count of unique historical blocks.
- **19,159 exact copies / 2,152,532,167 bytes** proved redundant.
- **38 different directories / 455,669 bytes** retained. Authenticated Zebra
  end-hash checks classified all 38 as noncanonical branches.
- All **117 protected/retained directories** remained present and pinned after
  recovery. No branch, unknown or prior unpublished payload was deleted.

All inventoried archive readers were quiesced before deletion. The native API's
old PID 1079955 exited; the legacy proxy/socket were stopped to prevent reader
activation. No container mounted this archive. The current catalog and all active
payload paths were excluded from reclamation. This was **offline GC**, not an
online reader-lease implementation.

The apply tool rechecked every pin under the writer lock, created a metadata
backup, read it back and fsynced a journal before removing only flat allowlisted
files in proven redundant directories. The archive byte delta exactly matched
the proof. Manifests, source provenance, proof and pre-GC catalog remain in a
14,431,776-byte private audit archive:

```text
metadata backup SHA-256
b3ae18e457ec828a6750b748866a50f91b5b3f997489e81ec6ebfea8685f9c33

catalog file SHA-256 before and immediately after GC
f6ab4cd11538d1f4add564dc82b78090a9174cbefead1cb513dee5fb4b0a2917

retired proof file SHA-256
273cbe0dedbeaa89987972c6f391d0b7fb016dd493c5755d35e6e74bbaac38e9
```

GC reduced archive bytes to **23,379,849,174**, leaving **2,121,519,146 bytes**
after the append reserve under the original 24 GiB budget. Epoch, revision,
head/hash and catalog bytes were unchanged by GC. Old catalogs referencing
deleted copies are no longer independently restorable physical snapshots;
the active archive retains their identical full logical records.

## Recovery, allocation and measured restart cost

The same writer and API binaries were restarted after GC. The proxy dependency
also stopped two Zeer public-demo Chef units; those were restored after source
readiness. The separate ZeeSwap Chef containers were never restarted.

After recovery was proven under the original budget, the user explicitly
approved **Prep 24 → 26 GiB** and the shared Zeer storage envelope **60 → 64 GiB**.
Only the writer restarted for this argument change; API PID 1163383 and consumer
containers stayed intact. CPU/memory and the 25 GiB physical free-space reserve
were preserved. This allocates capacity on the existing disk; it does not
provision a paid volume or eliminate finite-storage constraints. Separate
user-requested cleanup outside Zeer also increased physical free space and is not
counted as archive GC savings.

| Measured operation | Seconds |
| --- | ---: |
| Retired-copy proof, 50% CPU / 768 MiB cgroup | 407.524 |
| First writer full archive admission | 573 |
| First writer start → ready operation | 580.822 |
| First writer start → API first observed ready | 984.008 |
| Writer-only admission for approved budget change | 506 |
| Budget writer start → API first observed fresh new head | 510.612 |

The verifier's peak process RSS was 98,400 KiB. Writer startup temporarily used
100% CPU, restored to 50% after a genuine fresh observation. API remained at
50% CPU; both production services retained 1 GiB memory limits. Cgroups experienced
file-cache pressure, with nonzero `memory.events.max`, but no observed OOM or
OOM kill. Restart cost remains substantial. These observations use different
cache/concurrency conditions; they are not a cold-start or speedup benchmark.

The first recovery observed 8 newly published
heads and 6 data queries with HTTP outcomes {200: 6}.
After the allocation change, the observer verified
5 further distinct newly published heads against
Zebra and issued 6 data queries across genesis,
pre-failure and recovered ranges; HTTP outcomes were {200: 6}. Generation,
anchor, original head hash and container identity checks passed. Source timestamps
came from actual authenticated RPC observations; `STATUS_STALE` remained visible
during admission rather than refreshing old timestamps artificially.

## Executable and verification identity

Production writer remains `prep 0.1.0`, source commit
`63331816537545f0d059d61a2f453fcabeb6a1b8`, with clean embedded build metadata:

```text
/opt/zeer-testnet/catalog-incident-20261027/prep
81f34e6c34f7e62f52671fb506c8bbe3c229e96fad0ce5c8ca7d6ffe97550a1d
```

The existing API executable remains:

```text
/opt/zeer-testnet/startup-20261021/bin/prep-optimized
d788ea8b25216b4e0fe21b3336bf4955fa670f890a764ca6adab91da6758c414
```

The historical API binary has no new embedded commit attestation; its exact
running executable SHA was verified. The verifier/apply source is commit
`74e0a5f8498ba2dfb006f59b300c08d3513d3198`; the verifier executable SHA is
`72e3e09e0f39875e4bdb77a663a96a888653971581305554473b9aab2ed56b99`.
The apply script SHA is
`7cb5fd0b5a892b645c31d6a19277d70388a8a34a3b754258b59e28f3e949d3ba`.
One post-start audit collection initially saw the Python wrapper before its exec;
the collector was corrected by checking actual `/proc` arguments/executable
without another restart. Runtime `--max-disk-gib 26` was verified directly.

Fresh checks passed: **69 store tests, four verifier tests, six Python deletion
safety tests**, Clippy with warnings denied, rustfmt and the 45-page static docs
build. No Chef SDK release or schema upgrade was required.

See the [offline GC runbook](PREP_OFFLINE_GC.md) and
[curated evidence](../apps/docs/static/operations/2026-10-28-prep-archive-budget-recovery.json).
Reconstruct its arithmetic and acceptance checks with:

```sh
node apps/docs/scripts/verify-archive-budget-recovery.mjs
```

Private operational records and the metadata backup are retained under
`/opt/zeer-testnet/archive-budget-20261028/`. Capacity remains finite: track
archive margin after append reserve separately from physical free disk and the
aggregate guard. Repeating consolidation does not remove retired copies. Future
online GC needs explicit reader lifetime coordination; it is not provided here.
