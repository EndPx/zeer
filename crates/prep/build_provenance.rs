//! Build-time only. Never invoked by an installed Prep binary.
use std::{
    ffi::OsString,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub struct Provenance {
    pub commit: String,
    pub state: &'static str,
    pub watch: Vec<PathBuf>,
}

pub fn sanitized_env(
    values: impl Iterator<Item = (OsString, OsString)>,
) -> Vec<(OsString, OsString)> {
    values
        .filter(|(key, _)| {
            !key.to_string_lossy()
                .to_ascii_uppercase()
                .starts_with("GIT_")
        })
        .collect()
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let mut child = Command::new("git")
        .args([
            "--no-pager",
            "--no-optional-locks",
            "-c",
            "core.fsmonitor=false",
        ])
        .args(args)
        .current_dir(root)
        .env_clear()
        .envs(sanitized_env(std::env::vars_os()))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let output = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        output.take(4097).read_to_end(&mut bytes).ok()?;
        Some(bytes)
    });
    let start = Instant::now();
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if start.elapsed() < Duration::from_secs(5) => {
                thread::sleep(Duration::from_millis(10))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    if !success {
        return None;
    }
    // Git status can consult configured helpers. Do not wait indefinitely for
    // a descendant that inherited stdout after the parent command has exited.
    let finished = Instant::now();
    while !reader.is_finished() && finished.elapsed() < Duration::from_secs(1) {
        thread::sleep(Duration::from_millis(10));
    }
    if !reader.is_finished() {
        return None;
    }
    let bytes = reader.join().ok()??;
    if bytes.len() > 4096 {
        return None;
    }
    Some(String::from_utf8(bytes).ok()?.trim().to_owned())
}

pub fn valid_commit(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn detect(manifest: &Path) -> Provenance {
    let mut result = Provenance {
        commit: "unknown".into(),
        state: "unknown",
        watch: Vec::new(),
    };
    let Some(root) = git(manifest, &["rev-parse", "--show-toplevel"])
        .and_then(|root| PathBuf::from(root).canonicalize().ok())
    else {
        return result;
    };
    let Ok(package) = manifest.canonicalize() else {
        return result;
    };
    if !package.starts_with(&root) {
        return result;
    }
    // A package copied into an unrelated parent repository has no provenance.
    for relative in ["Cargo.toml", "src/lib.rs"] {
        if git(manifest, &["ls-files", "--error-unmatch", "--", relative]).as_deref()
            != Some(relative)
            || !manifest.join(relative).is_file()
        {
            return result;
        }
    }
    let Some(commit) =
        git(manifest, &["rev-parse", "--verify", "HEAD"]).filter(|value| valid_commit(value))
    else {
        return result;
    };
    // Scope dirty-state inspection to native build inputs. The workspace also
    // contains web dependencies and media that can make an unrelated recursive
    // status expensive on mounted filesystems.
    let mut status_args = vec![
        "status",
        "--porcelain",
        "--untracked-files=normal",
        "--",
        ".",
    ];
    for path in [
        "../prep-store",
        "../prep-proto",
        "../../Cargo.toml",
        "../../Cargo.lock",
        "../../rust-toolchain.toml",
        "../../rust-toolchain",
        "../../.cargo",
    ] {
        if manifest
            .join(path)
            .canonicalize()
            .is_ok_and(|path| path.starts_with(&root))
        {
            status_args.push(path);
        }
    }
    let Some(status) = git(manifest, &status_args) else {
        return result;
    };
    result.commit = commit;
    result.state = if status.is_empty() {
        "clean"
    } else {
        "modified"
    };
    let mut paths = vec![
        "HEAD".to_owned(),
        "index".to_owned(),
        "packed-refs".to_owned(),
    ];
    if let Some(reference) = git(manifest, &["symbolic-ref", "-q", "HEAD"]) {
        if reference.starts_with("refs/") && !reference.contains(['\n', '\r']) {
            paths.push(reference);
        }
    }
    for path in paths {
        if let Some(path) = git(manifest, &["rev-parse", "--git-path", &path]) {
            let path = PathBuf::from(path);
            result.watch.push(if path.is_absolute() {
                path
            } else {
                manifest.join(path)
            });
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracked_source_is_identified_and_unrelated_parent_repo_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::create_dir(root.join("src")).unwrap();
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname='prep'\nversion='0.1.0'\n",
        )
        .unwrap();
        std::fs::write(root.join("src/lib.rs"), "// fixture\n").unwrap();
        assert!(git(root, &["init", "--quiet", "--template="]).is_some());
        assert!(git(root, &["add", "Cargo.toml", "src/lib.rs"]).is_some());
        assert!(git(
            root,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "fixture"
            ]
        )
        .is_some());
        let clean = detect(root);
        assert!(valid_commit(&clean.commit));
        assert_eq!(clean.state, "clean");
        std::fs::write(root.join("src/lib.rs"), "// changed fixture\n").unwrap();
        assert_eq!(detect(root).state, "modified");
        let copied = root.join("copied");
        std::fs::create_dir_all(copied.join("src")).unwrap();
        std::fs::copy(root.join("Cargo.toml"), copied.join("Cargo.toml")).unwrap();
        std::fs::copy(root.join("src/lib.rs"), copied.join("src/lib.rs")).unwrap();
        let unknown = detect(&copied);
        assert_eq!(unknown.commit, "unknown");
        assert_eq!(unknown.state, "unknown");
    }
}
