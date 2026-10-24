# Chef 0.6.0 acceptance

Chef and launcher 0.6.0 were published and verified on 23 October 2026. At that verification, both `latest` tags selected 0.6.0, that version's launcher pinned Chef 0.6.0, and anonymous registry tarball downloads matched the audited candidates byte for byte. The later [0.6.1 patch](CHEF_061_ACCEPTANCE.md) supersedes those latest tags without changing the runtime.

## Real testnet breakdown

An independent Linux project installed the audited Chef 0.6.0 tarball, without a workspace symlink, generated types, typechecked, migrated its own PostgreSQL namespace and indexed blocks **4,515,162–4,515,166 inclusive** through public Prep.

| Item | Observed value |
| --- | --- |
| Spending TX ID | `1dc8ca68f7fa920f4262cebaf70adbf21dcff6a2bf6d59908c3f5ecab9f8f751` |
| Funding TX ID | `8a6abdc867dbed8f878bf5b3258253ed3e5f0bd634f839b4c30fa4b90517b69e` |
| Referenced funding output | index `2`, block `4515162` |
| Spending block | `4515166` |
| Resolved input value | `247950000` zatoshi |
| Address present in funding output script | `tmCARs7pqhUaYwev5vi3Fn3V7oB8PYzKmUS` |
| Spending outputs | 3 outputs, values `0`, `10000`, `247920000` zatoshi |
| Checkpoint block hash | `0000225c01f24fd700031d3d1bc09fff8d106acc0858cb24020d6395125ed9c2` |

The nested GraphQL result matched the public decoded funding output. No sender identity or change classification was inferred. The configured live chain source subsequently reported both transactions mined; its spending-block hash matched Chef's checkpoint. This is a configured-source observation, not independent consensus validation or a speed benchmark.

A second fresh namespace indexed only block 4515166. Its input correctly returned `resolution: "unresolved"`, `valueZat: null`, `addresses: null`, and `previousOutput: null` because its funding output was outside that project's history. Restarting the complete project and repeating the bounded sync/query returned an identical result without duplicate entities.

The installed public helper also fetched the real previous output using Prep's pinned batch-lookup snapshot. Core Prep allows up to 10,000 blocks per batch lookup; the hosted public preview applies a stricter 1,000-block range cap. The acceptance used that public limit. Missing IDs refer only to the requested range.

## Platform and package checks

- **187 SDK tests passed on Linux x64**, Node 24.18.0, real PostgreSQL 18 and the checksum-verified published scanner `scanner-v0.1.0-testnet.1`. Zero skipped/failed tests. Scanner fixtures are public unfunded fixtures, distinct from the mined transparent example above.
- **3 launcher tests passed** on Linux.
- The SDK tarball includes compiled transparent helpers and declarations; neither SDK nor launcher includes node_modules or protected key/env files. The launcher pins Chef 0.6.0.
- The standalone candidate project passed codegen, strict typechecking, migration, bounded live sync, authenticated nested GraphQL, restart and real previous-output prefetch.
- A separate project installed Chef 0.6.0 from the npm registry and repeated codegen, strict typechecking, migration, the same testnet sync, nested GraphQL, restart and previous-output prefetch. Every check passed; the prefetch snapshot boundary hash matched the Chef checkpoint.
- The registry launcher generated Blank, Public and Shielded projects with the exact SDK dependency. Public and Shielded passed codegen and typechecking; the Shielded check supplied only a fingerprint derived from an unfunded public fixture. Blank correctly refused codegen until a schema was defined. All three refused to overwrite existing projects. An actual `pnpm dlx @zeer-dev/cli@0.6.0 --version` returned `0.6.0`.

Detailed logs, tarball hashes, source responses and project-specific data remain in the ignored local release folder. They contain no wallet signing authority. This acceptance ran no payout, swap or newly funded transaction and did not migrate hosted namespaces. Starter generation and fixture checks do not establish a funded shielded wallet's readiness.
