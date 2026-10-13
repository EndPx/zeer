use std::{net::SocketAddr, path::PathBuf};

use anyhow::Result;
use clap::{Parser, Subcommand};
use prep::{
    importer::{import, ImportOptions},
    server::{serve, validate_listen},
};
use prep_store::Store;

#[derive(Parser)]
#[command(
    name = "prep",
    version,
    about = "Experimental immutable Zcash CompactBlock snapshots. No live-chain or wallet service."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
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
