//! Real process boundary tests; all key material is the explicitly public, unfunded fixture.
use serde_json::Value;
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/shielded.json")).unwrap()
}
fn file(dir: &std::path::Path) -> std::path::PathBuf {
    let path = dir.join("fixture.ufvk");
    fs::write(&path, fixture()["ufvk"].as_str().unwrap()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    }
    path
}
#[test]
fn local_process_returns_a_complete_frame_without_printing_the_key() {
    let dir = tempfile::tempdir().unwrap();
    let key = file(dir.path());
    let data = fixture();
    let mut process = Command::new(env!("CARGO_BIN_EXE_zeer-scanner"))
        .args(["serve", "--key-file"])
        .arg(&key)
        .args(["--account", "fixture"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = process.stdin.take().unwrap();
    writeln!(input, "{}", data["request"]).unwrap();
    drop(input);
    let output = process.wait_with_output().unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(!text.contains(data["ufvk"].as_str().unwrap()));
    let frames = text
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(frames.len(), 2);
    assert!(frames[0]["ready"]["stateless"].as_bool().unwrap());
    assert_eq!(frames[1]["result"]["complete"], true);
    assert_eq!(frames[1]["result"]["receipts"].as_array().unwrap().len(), 6);
    assert!(frames[1]["result"]["receipts"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["is_coinbase"] == false));
}
#[test]
fn a_truncated_frame_is_never_a_successful_partial_scan() {
    let dir = tempfile::tempdir().unwrap();
    let key = file(dir.path());
    let mut process = Command::new(env!("CARGO_BIN_EXE_zeer-scanner"))
        .args(["serve", "--key-file"])
        .arg(&key)
        .args(["--account", "fixture"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    process
        .stdin
        .take()
        .unwrap()
        .write_all(b"{\"protocol_version\":1")
        .unwrap();
    let output = process.wait_with_output().unwrap();
    assert!(!output.status.success());
    assert_eq!(String::from_utf8(output.stdout).unwrap().lines().count(), 1);
    assert_eq!(
        String::from_utf8(output.stderr).unwrap().trim(),
        "INVALID_OR_TRUNCATED_FRAME"
    );
}
#[cfg(unix)]
#[test]
fn key_files_require_owner_only_permissions_and_are_not_followed_through_symlinks() {
    use std::os::unix::{fs::symlink, fs::PermissionsExt};
    let dir = tempfile::tempdir().unwrap();
    let key = file(dir.path());
    fs::set_permissions(&key, fs::Permissions::from_mode(0o644)).unwrap();
    let denied = Command::new(env!("CARGO_BIN_EXE_zeer-scanner"))
        .args(["inspect-key", "--key-file"])
        .arg(&key)
        .args(["--account", "fixture"])
        .output()
        .unwrap();
    assert!(!denied.status.success());
    assert!(denied.stdout.is_empty());
    assert_eq!(
        String::from_utf8(denied.stderr).unwrap().trim(),
        "KEY_FILE_PERMISSIONS_REQUIRE_OWNER_ONLY"
    );
    fs::set_permissions(&key, fs::Permissions::from_mode(0o600)).unwrap();
    let link = dir.path().join("link.ufvk");
    symlink(&key, &link).unwrap();
    let denied = Command::new(env!("CARGO_BIN_EXE_zeer-scanner"))
        .args(["inspect-key", "--key-file"])
        .arg(&link)
        .args(["--account", "fixture"])
        .output()
        .unwrap();
    assert!(!denied.status.success());
    assert_eq!(
        String::from_utf8(denied.stderr).unwrap().trim(),
        "INVALID_KEY_FILE"
    );
}
