//! Explicit operator utility for a new, isolated testnet account. Never imported by the scanner.
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};
use zcash_keys::{address::UnifiedAddress, keys::UnifiedSpendingKey};
use zcash_protocol::consensus::TEST_NETWORK;
use zeer_scanner::Scanner;
use zeroize::Zeroizing;
use zip32::{AccountId, Scope};
fn private_file(path: PathBuf, body: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(body)?;
    file.sync_all()
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or("absolute output directory required")?,
    );
    if !dir.is_absolute() {
        return Err("absolute output directory required".into());
    }
    fs::create_dir(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
    }
    let mut seed = Zeroizing::new([0u8; 32]);
    getrandom::fill(&mut *seed).map_err(|_| "OS entropy unavailable")?;
    let fvk = UnifiedSpendingKey::from_seed(&TEST_NETWORK, &*seed, AccountId::ZERO)?
        .to_unified_full_viewing_key();
    let key = Zeroizing::new(fvk.encode(&TEST_NETWORK)?);
    let address = UnifiedAddress::from_receivers(
        Some(
            fvk.orchard()
                .ok_or("Orchard key missing")?
                .address_at(0u32, Scope::External),
        ),
        None,
        None,
        None,
        None,
    )
    .ok_or("receiver unavailable")?
    .encode(&TEST_NETWORK);
    private_file(
        dir.join("seed.hex"),
        Zeroizing::new(hex::encode(seed.as_slice())).as_bytes(),
    )?;
    private_file(dir.join("viewing-key.txt"), key.as_bytes())?;
    let scanner = Scanner::new("zeer_testnet", &key)?;
    private_file(
        dir.join("account.json"),
        &serde_json::to_vec_pretty(
            &serde_json::json!({"network":"testnet","account_id":"zeer_testnet","address":address,"key_fingerprint":scanner.fingerprint(),"purpose":"isolated Zeer receipt verification; not a production wallet"}),
        )?,
    )?;
    println!("Created isolated testnet account. Key material was written only to protected files.");
    Ok(())
}
