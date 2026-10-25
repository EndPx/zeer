use std::process::Command;

#[test]
fn build_info_is_keyless_and_independent_of_cwd_git_and_source_environment() {
    let directory = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_prep"))
        .arg("build-info")
        .current_dir(directory.path())
        .env("GIT_DIR", "/nonexistent-private-repository")
        .env("GIT_WORK_TREE", "/nonexistent-private-worktree")
        .env("PREP_SOURCE_USER", "private-user")
        .env_remove("PREP_SOURCE_PASSWORD")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        value,
        serde_json::to_value(prep::artifact::identity()).unwrap()
    );
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(!text.contains("private"));
}
