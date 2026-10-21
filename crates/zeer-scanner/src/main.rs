use clap::{Parser, Subcommand};
use serde_json::{json, Value};
use std::{
    fs::File,
    io::{self, BufRead, Read, Write},
    path::PathBuf,
};
use zeer_scanner::{ScanError, ScanRequest, Scanner, MAX_FRAME_BYTES};
use zeroize::Zeroizing;

#[derive(Parser)]
#[command(version)]
#[command(about = "Local testnet watch-only receipt scanner; no wallet signing or network access")]
struct Args {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    /// Print compiled support without reading any key.
    Capabilities,
    /// Inspect a watch-only key's fingerprint and default receiver components locally.
    InspectKey {
        #[arg(long)]
        key_file: PathBuf,
        #[arg(long)]
        account: String,
    },
    /// Read bounded JSONL requests from stdin; stdout contains private receipt data.
    Serve {
        #[arg(long)]
        key_file: PathBuf,
        #[arg(long)]
        account: String,
    },
}
fn key_file(path: &PathBuf) -> Result<Zeroizing<String>, ScanError> {
    if !path.is_absolute() {
        return Err(ScanError("KEY_FILE_MUST_BE_ABSOLUTE"));
    }
    let meta = std::fs::symlink_metadata(path).map_err(|_| ScanError("KEY_FILE_UNAVAILABLE"))?;
    if !meta.is_file() || meta.len() > 4096 {
        return Err(ScanError("INVALID_KEY_FILE"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            return Err(ScanError("KEY_FILE_PERMISSIONS_REQUIRE_OWNER_ONLY"));
        }
    }
    let mut text = Zeroizing::new(String::new());
    File::open(path)
        .and_then(|f| f.take(4097).read_to_string(&mut text))
        .map_err(|_| ScanError("KEY_FILE_UNAVAILABLE"))?;
    if text.len() > 4096 {
        return Err(ScanError("INVALID_KEY_FILE"));
    }
    Ok(text)
}
fn frame(out: &mut impl Write, value: &Value) -> Result<(), ScanError> {
    let body = serde_json::to_vec(value).map_err(|_| ScanError("SCANNER_SERIALIZATION_FAILED"))?;
    if body.len() >= MAX_FRAME_BYTES {
        return Err(ScanError("SCANNER_RESPONSE_TOO_LARGE"));
    }
    out.write_all(&body)
        .and_then(|_| out.write_all(b"\n"))
        .and_then(|_| out.flush())
        .map_err(|_| ScanError("SCANNER_OUTPUT_CLOSED"))
}
fn serve(scanner: Scanner) -> Result<(), ScanError> {
    let mut out = io::stdout().lock();
    frame(&mut out, &json!({"ready":scanner.capabilities()}))?;
    let mut input = io::stdin().lock();
    loop {
        let mut line = Vec::new();
        let count = (&mut input)
            .take((MAX_FRAME_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)
            .map_err(|_| ScanError("SCANNER_INPUT_FAILED"))?;
        if count == 0 {
            return Ok(());
        }
        if line.len() > MAX_FRAME_BYTES || line.last() != Some(&b'\n') {
            return Err(ScanError("INVALID_OR_TRUNCATED_FRAME"));
        }
        let request: ScanRequest =
            serde_json::from_slice(&line).map_err(|_| ScanError("INVALID_SCAN_REQUEST"))?;
        match scanner.scan(&request) {
            Ok(result) => frame(&mut out, &json!({"result":result}))?,
            Err(error) => {
                frame(
                    &mut out,
                    &json!({"request_id":request.request_id,"error":{"code":error.0}}),
                )?;
                return Err(error);
            }
        }
    }
}
fn run() -> Result<(), ScanError> {
    match Args::parse().command {
        Command::Capabilities => frame(
            &mut io::stdout().lock(),
            &json!({"scanner_version":env!("CARGO_PKG_VERSION"),"protocol_version":1,"network":"testnet","pools":["sapling","orchard","ironwood"],"watch_only":true,"stateless":true,"key_file_required":true,"max_frame_bytes":MAX_FRAME_BYTES}),
        ),
        Command::InspectKey {
            key_file: path,
            account,
        } => {
            let key = key_file(&path)?;
            frame(
                &mut io::stdout().lock(),
                &Scanner::new(&account, key.trim())?.profile(),
            )
        }
        Command::Serve {
            key_file: path,
            account,
        } => {
            let key = key_file(&path)?;
            serve(Scanner::new(&account, key.trim())?)
        }
    }
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{}", error.0);
        std::process::exit(1);
    }
}
