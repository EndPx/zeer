use std::{net::SocketAddr, path::PathBuf};

use anyhow::{ensure, Result};
use clap::{Parser, Subcommand};
use prep::follower::{SyncOptions, SyncSession};
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
        #[arg(long, default_value_t = 5)]
        poll_seconds: u64,
        /// Optional finite step budget for rehearsals. Not a complete-chain claim.
        #[arg(long)]
        max_steps: Option<u64>,
    },
    /// Verify all referenced segments and print the durable archive catalog.
    ArchiveInspect {
        #[arg(long)]
        archive: PathBuf,
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
            poll_seconds,
            max_steps,
        } => {
            ensure!(
                (1..=60).contains(&poll_seconds),
                "poll_seconds_must_be_1_to_60"
            );
            ensure!(
                !follow || to.is_none(),
                "follow_cannot_have_fixed_end_height"
            );
            ensure!(
                max_steps.is_none_or(|n| n > 0),
                "max_steps_must_be_positive"
            );
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
            };
            let mut session = SyncSession::new(options).await?;
            let signal = tokio::signal::ctrl_c();
            tokio::pin!(signal);
            let mut steps = 0_u64;
            loop {
                let progress = tokio::select! {
                    _ = &mut signal => break,
                    result = session.step() => result?,
                };
                println!("{}", serde_json::to_string(&progress)?);
                steps += 1;
                if max_steps.is_some_and(|limit| steps >= limit)
                    || (!follow
                        && (!progress.progress
                            || to.is_some_and(|end| progress.head.is_some_and(|head| head >= end))))
                {
                    break;
                }
                if !progress.progress {
                    tokio::select! {
                        _ = &mut signal => break,
                        _ = tokio::time::sleep(std::time::Duration::from_secs(poll_seconds)) => {},
                    }
                }
            }
        }
        Command::ArchiveInspect { archive } => {
            let archive = tokio::task::spawn_blocking(move || Archive::open(archive)).await??;
            println!("{}", serde_json::to_string_pretty(archive.catalog())?);
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
