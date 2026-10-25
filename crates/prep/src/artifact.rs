//! Immutable metadata for the binary that is running, not runtime checkout HEAD.
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactIdentity {
    pub schema_version: u32,
    pub package_name: &'static str,
    pub package_version: &'static str,
    pub build_commit: &'static str,
    pub source_state: &'static str,
}

pub fn identity() -> ArtifactIdentity {
    ArtifactIdentity {
        schema_version: 1,
        package_name: env!("CARGO_PKG_NAME"),
        package_version: env!("CARGO_PKG_VERSION"),
        build_commit: env!("PREP_BUILD_COMMIT"),
        source_state: env!("PREP_SOURCE_STATE"),
    }
}

#[cfg(test)]
#[path = "../build_provenance.rs"]
mod provenance;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artifact_has_only_bounded_build_metadata() {
        let value = serde_json::to_value(identity()).unwrap();
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["packageName"], "prep");
        assert_eq!(value.as_object().unwrap().len(), 5);
        let commit = value["buildCommit"].as_str().unwrap();
        assert!(commit == "unknown" || provenance::valid_commit(commit));
        assert!(matches!(
            value["sourceState"].as_str().unwrap(),
            "unknown" | "clean" | "modified"
        ));
        if commit == "unknown" {
            assert_eq!(value["sourceState"], "unknown");
        }
    }

    #[test]
    fn untracked_source_and_inherited_git_redirection_are_not_provenance() {
        let directory = tempfile::tempdir().unwrap();
        let result = provenance::detect(directory.path());
        assert_eq!(result.commit, "unknown");
        assert_eq!(result.state, "unknown");
        assert!(result.watch.is_empty());
        let env = provenance::sanitized_env(
            [
                ("GIT_DIR", "secret"),
                ("git_work_tree", "secret"),
                ("GIT_CONFIG_COUNT", "1"),
                ("PATH", "kept"),
            ]
            .into_iter()
            .map(|(key, value)| (key.into(), value.into())),
        );
        assert_eq!(env, vec![("PATH".into(), "kept".into())]);
        for invalid in [
            "a".repeat(39),
            "A".repeat(40),
            "https://private".to_owned(),
            "a".repeat(41),
        ] {
            assert!(!provenance::valid_commit(&invalid));
        }
    }
}
