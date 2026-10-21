//! Fresh-process admission only. No after-admission full-history verification scan.
use prep_store::profiling;
use serde_json::json;
use std::{env, fs};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let root = args.next().ok_or("Usage: startup_profile ARCHIVE")?;
    if args.next().is_some() {
        return Err("unexpected argument".into());
    }
    let (archive, profile) = profiling::open_with_progress(root, None)?;
    println!(
        "{}",
        serde_json::to_string(&json!({"format":"prep-startup-profile-v1",
        "network":archive.catalog().network,"head":archive.head(),"head_hash":archive.head_hash(),
        "catalog_sha256":archive.catalog().catalog_sha256,"profile":profile,
        "proc_status":fs::read_to_string("/proc/self/status").ok(),
        "proc_io":fs::read_to_string("/proc/self/io").ok()}))?
    );
    Ok(())
}
