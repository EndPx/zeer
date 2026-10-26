use std::{net::SocketAddr, path::PathBuf};

use anyhow::{ensure, Result};
use clap::{Parser, Subcommand};
use prep::follower::SyncOptions;
use prep::{
    importer::{import, ImportOptions},
    server::{serve, validate_listen},
};
use prep_store::{Archive, Store};

#[derive(Parser)]
#[command(
    name = "prep",
    version,
    about = "Zeer Prep: full-block archives, bounded queries, and compact snapshots."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print embedded binary provenance without connecting to a source or archive.
    BuildInfo,
    /// Backfill complete blocks from a full-node JSON-RPC source; resume an archive.
    Sync {
        #[arg(long)]
        source: String,
        #[arg(long, value_parser = ["mainnet", "testnet", "regtest"])]
        network: String,
        #[arg(long)]
        archive: PathBuf,
        #[arg(long, default_value_t = 1)]
        from: u64,
        /// Inclusive terminal height; omitted means catch up to confirmed source tip.
        #[arg(long)]
        to: Option<u64>,
        #[arg(long, default_value_t = 100)]
        segment_blocks: u64,
        #[arg(long, default_value_t = 10)]
        confirmations: u64,
        #[arg(long, default_value_t = 100)]
        max_reorg_blocks: u64,
        #[arg(long, default_value_t = 4)]
        max_disk_gib: u64,
        #[arg(long, default_value_t = 120)]
        deadline_seconds: u64,
        #[arg(long)]
        allow_insecure: bool,
        /// Poll for new confirmed blocks after catch-up; detects bounded reorgs.
        #[arg(long)]
        follow: bool,
        /// Compress each immutable full-block record without changing query output.
        #[arg(long)]
        compress: bool,
        #[arg(long, default_value_t = 5)]
        poll_seconds: u64,
        /// Optional finite step budget for rehearsals. Not a complete-chain claim.
        #[arg(long)]
        max_steps: Option<u64>,
        /// Consecutive temporary-source retries in follow mode (0 disables).
        #[arg(long, default_value_t = 8)]
        max_source_retries: u32,
    },
    /// Offline build of bounded metadata sidecars; stop sync/follow first and restart readers afterwards.
    ArchiveIndexBuild {
        #[arg(long)]
        archive: PathBuf,
        #[arg(long, default_value_t = 4)]
        max_disk_gib: u64,
    },
    /// Verify all referenced segments and print the durable archive catalog.
    ArchiveInspect {
        #[arg(long)]
        archive: PathBuf,
    },
    /// Losslessly merge historical full-data segments under one writer lock; retains old files.
    ArchiveConsolidate {
        #[arg(long)]
        archive: PathBuf,
        #[arg(long, default_value_t = 10_000)]
        target_segments: usize,
        #[arg(long, default_value_t = 128)]
        max_groups: usize,
        #[arg(long, default_value_t = 100)]
        protected_tail_blocks: u64,
        #[arg(long, default_value_t = 4)]
        max_disk_gib: u64,
        /// Maximum encoded bytes in one replacement segment, from 1 to 64 MiB.
        #[arg(long, default_value_t = 64 * 1024 * 1024)]
        max_segment_bytes: u64,
        /// Refuse a stale operator plan after acquiring the writer lock.
        #[arg(long)]
        expected_catalog_sha256: Option<String>,
    },
    /// Append checked compact segments to a compact archive, in height order.
    CompactArchiveAppend {
        #[arg(long)]
        archive: PathBuf,
        #[arg(long, value_parser = ["mainnet", "testnet", "regtest"])]
        network: String,
        #[arg(long)]
        from: u64,
        #[arg(long = "segment", required = true)]
        segments: Vec<String>,
    },
    /// Serve an immutable compact archive through the lightwallet block-retrieval subset.
    ServeCompact {
        #[arg(long)]
        archive: PathBuf,
        #[arg(long, default_value = "127.0.0.1:39479")]
        listen: SocketAddr,
        #[arg(long)]
        allow_network: bool,
    },
    /// Offline lossless compression into a new archive, with complete payload comparison.
    ArchiveRepack {
        #[arg(long)]
        archive: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value_t = 4)]
        max_disk_gib: u64,
        #[arg(long)]
        resume: bool,
    },
    /// Serve full-block queries over HTTP; protect non-loopback binds with a token.
    ServeHttp {
        #[arg(long)]
        archive: PathBuf,
        #[arg(long, default_value = "127.0.0.1:39368")]
        listen: SocketAddr,
        #[arg(long)]
        allow_network: bool,
    },
    /// Read a bounded range from a real lightwalletd-compatible source.
    Import {
        #[arg(long)]
        source: String,
        #[arg(long, value_parser = ["mainnet", "testnet", "regtest"])]
        network: String,
        #[arg(long)]
        start: u64,
        #[arg(long)]
        end: u64,
        #[arg(long)]
        out: PathBuf,
        /// Required independently supplied end-block hash in lowercase RPC hex.
        #[arg(long)]
        expected_end_hash: String,
        /// Permit plaintext HTTP to private-network sources, including Docker DNS.
        #[arg(long)]
        allow_insecure: bool,
        #[arg(long, default_value_t = 120)]
        deadline_seconds: u64,
        /// Store the protocol's shielded-only projection, preserving original tx indices.
        #[arg(long)]
        shielded_only: bool,
    },
    /// Fully verify an existing snapshot and print its manifest.
    Inspect {
        #[arg(long)]
        dataset: PathBuf,
    },
    /// Serve immutable historical data; this prototype has no authentication.
    Serve {
        #[arg(long)]
        dataset: PathBuf,
        #[arg(long, default_value = "127.0.0.1:39367")]
        listen: SocketAddr,
        /// Explicitly permit a non-loopback listener on a trusted network.
        #[arg(long)]
        allow_network: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        Command::BuildInfo => println!("{}", serde_json::to_string(&prep::artifact::identity())?),
        Command::CompactArchiveAppend {
            archive,
            network,
            from,
            segments,
        } => {
            let summary = tokio::task::spawn_blocking(move || {
                let mut writer = prep_store::ArchiveWriter::create_or_open(&archive, &network, from)?;
                for segment in segments {
                    if !writer.catalog().segments.iter().any(|entry| entry.directory == segment) {
                        writer.append_segment(&segment)?;
                    }
                }
                Ok::<_, prep_store::Error>(serde_json::json!({"network":network,"from":from,"head":writer.head(),"segments":writer.catalog().segments.len(),"catalog_sha256":writer.catalog().catalog_sha256}))
            }).await??;
            println!("{}", summary);
        }
        Command::ServeCompact {
            archive,
            listen,
            allow_network,
        } => {
            validate_listen(listen, allow_network)?;
            let archive =
                tokio::task::spawn_blocking(move || prep_store::Archive::open(archive)).await??;
            let listener = tokio::net::TcpListener::bind(listen).await?;
            eprintln!("Prep immutable compact retrieval at {}; no authentication, no live-chain or full-wallet API guarantee", listener.local_addr()?);
            prep::compact_rpc::serve(archive, listener, async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await?;
        }
        Command::ArchiveRepack {
            archive,
            out,
            max_disk_gib,
            resume,
        } => {
            let cap = max_disk_gib
                .checked_mul(1024 * 1024 * 1024)
                .ok_or_else(|| anyhow::anyhow!("disk_budget_overflow"))?;
            let proof = tokio::task::spawn_blocking(move || {
                prep::repack::repack_with_resume(&archive, &out, cap, resume)
            })
            .await??;
            println!("{}", serde_json::to_string(&proof)?);
        }
        Command::Sync {
            source,
            network,
            archive,
            from,
            to,
            segment_blocks,
            confirmations,
            max_reorg_blocks,
            max_disk_gib,
            deadline_seconds,
            allow_insecure,
            follow,
            compress,
            poll_seconds,
            max_steps,
            max_source_retries,
        } => {
            let max_archive_bytes = max_disk_gib
                .checked_mul(1024 * 1024 * 1024)
                .ok_or_else(|| anyhow::anyhow!("disk_budget_overflow"))?;
            let options = SyncOptions {
                source,
                network,
                archive,
                from,
                to,
                segment_blocks,
                confirmations,
                max_reorg_blocks,
                max_archive_bytes,
                deadline_seconds,
                allow_insecure,
                follow_mode: follow,
                compress,
            };
            prep::follow::run(
                options,
                prep::follow::LoopOptions {
                    poll_seconds,
                    max_steps,
                    max_source_retries,
                },
                async {
                    let _ = tokio::signal::ctrl_c().await;
                },
            )
            .await?;
        }
        Command::ArchiveIndexBuild {
            archive,
            max_disk_gib,
        } => {
            let cap = max_disk_gib
                .checked_mul(1024 * 1024 * 1024)
                .ok_or_else(|| anyhow::anyhow!("disk_budget_overflow"))?;
            let bytes = tokio::task::spawn_blocking(move || {
                Archive::build_transaction_disk_indexes(archive, cap)
            })
            .await??;
            println!("disk_metadata_bytes={bytes}; restart readers to discover sidecars");
        }
        Command::ArchiveInspect { archive } => {
            let archive = tokio::task::spawn_blocking(move || Archive::open(archive)).await??;
            println!("{}", serde_json::to_string_pretty(archive.catalog())?);
        }
        Command::ArchiveConsolidate {
            archive,
            target_segments,
            max_groups,
            protected_tail_blocks,
            max_disk_gib,
            max_segment_bytes,
            expected_catalog_sha256,
        } => {
            let max_archive_bytes = max_disk_gib
                .checked_mul(1024 * 1024 * 1024)
                .ok_or_else(|| anyhow::anyhow!("disk_budget_overflow"))?;
            let report = tokio::task::spawn_blocking(move || {
                prep::maintenance::consolidate_archive(
                    &archive,
                    prep::maintenance::ConsolidateOptions {
                        target_segments,
                        max_groups,
                        protected_tail_blocks,
                        max_archive_bytes,
                        max_segment_bytes,
                        expected_catalog_sha256,
                    },
                )
            })
            .await??;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Command::ServeHttp {
            archive,
            listen,
            allow_network,
        } => {
            validate_listen(listen, allow_network)?;
            let token = std::env::var("PREP_API_TOKEN").ok();
            ensure!(
                token.as_ref().is_none_or(|token| token.len() >= 16),
                "api_token_must_have_at_least_16_bytes"
            );
            ensure!(
                listen.ip().is_loopback() || token.is_some(),
                "nonloopback_http_requires_PREP_API_TOKEN"
            );
            let archive = tokio::task::spawn_blocking(move || Archive::open(archive)).await??;
            let listener = tokio::net::TcpListener::bind(listen).await?;
            eprintln!(
                "Prep HTTP listening on {}; use trusted-network access or a TLS proxy",
                listener.local_addr()?
            );
            prep::http::serve(archive, listener, token, async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await?;
        }
        Command::Import {
            source,
            network,
            start,
            end,
            out,
            expected_end_hash,
            allow_insecure,
            deadline_seconds,
            shielded_only,
        } => {
            let manifest = import(ImportOptions {
                source,
                network,
                start,
                end,
                out,
                expected_end_hash,
                allow_insecure,
                deadline_seconds,
                shielded_only,
            })
            .await?;
            println!("{}", serde_json::to_string_pretty(&manifest)?);
        }
        Command::Inspect { dataset } => {
            let store = tokio::task::spawn_blocking(move || Store::open(dataset)).await??;
            println!("{}", serde_json::to_string_pretty(store.manifest())?);
        }
        Command::Serve {
            dataset,
            listen,
            allow_network,
        } => {
            validate_listen(listen, allow_network)?;
            let store = tokio::task::spawn_blocking(move || Store::open(dataset)).await??;
            let listener = tokio::net::TcpListener::bind(listen).await?;
            eprintln!("Prep immutable historical snapshot {} listening on {}; no authentication or current-chain guarantee", store.manifest().dataset_id, listener.local_addr()?);
            serve(store, listener, async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await?;
        }
    }
    Ok(())
}
