//! Read-only proof for offline, operator-coordinated reclamation. This does not
//! authorize deletion or discover readers; the operator must quiesce all readers
//! and recheck the catalog and file pins before applying a separately saved plan.
use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct Plan {
    catalog_file_sha256: String,
    candidates: Vec<Candidate>,
}

#[derive(Deserialize, Serialize)]
struct Candidate {
    directory: String,
    files: Vec<PinnedFile>,
}

#[derive(Deserialize, Serialize)]
struct PinnedFile {
    name: String,
    bytes: u64,
    sha256: String,
}

#[derive(Serialize)]
pub(super) struct RetirementProof {
    status: &'static str,
    scope: &'static str,
    plan_sha256: String,
    catalog_file_sha256: String,
    catalog_head: u64,
    catalog_head_hash: String,
    catalog_epoch: u64,
    catalog_revision: u64,
    candidates: usize,
    records_compared: u64,
    eligible_bytes: u64,
    eligible: Vec<Candidate>,
    retained: Vec<Retained>,
    elapsed_seconds: f64,
}

#[derive(Serialize)]
struct Retained {
    directory: String,
    reason: &'static str,
}

pub(super) fn verify(
    root: &Path,
    plan_path: &Path,
    expected_plan: &str,
) -> Result<RetirementProof> {
    let began = Instant::now();
    check(cfg!(unix), "UNIX_WRITER_LOCK_REQUIRED")?;
    check(hash_text(expected_plan), "PLAN_PIN_INVALID")?;
    directory(root)?;
    directory(&root.join("segments"))?;
    // Serialize with the real archive writer; API readers can remain online
    // during this read-only comparison. They MUST be stopped before deletion.
    let lock = regular(&root.join("archive.lock"))?;
    lock.try_lock()?;
    let plan_bytes = bounded_bytes(plan_path, 32 * 1024 * 1024)?;
    check(hash(&plan_bytes) == expected_plan, "PLAN_PIN_MISMATCH")?;
    let plan: Plan = serde_json::from_slice(&plan_bytes)?;
    check(plan.candidates.len() <= 30_000, "CANDIDATE_BOUND_EXCEEDED")?;
    let (current, _, catalog_hash) = catalog(&root.join("catalog.json"))?;
    check(
        catalog_hash == plan.catalog_file_sha256,
        "CATALOG_PIN_MISMATCH",
    )?;
    let active: HashSet<_> = current
        .segments
        .iter()
        .map(|r| r.directory.as_str())
        .collect();
    let mut names = HashSet::new();
    let mut candidates = Vec::new();
    for candidate in plan.candidates {
        check(
            !active.contains(candidate.directory.as_str()),
            "CANDIDATE_STILL_ACTIVE",
        )?;
        check(
            names.insert(candidate.directory.clone()),
            "DUPLICATE_CANDIDATE",
        )?;
        let reference = SegmentReference {
            directory: candidate.directory.clone(),
            // Only the directory field is used by segment_path.
            dataset_id: String::new(),
            manifest_sha256: String::new(),
            start_height: 0,
            end_height: 0,
            predecessor_hash: String::new(),
            end_hash: String::new(),
        };
        let path = segment_path(root, &reference)?;
        let actual: HashSet<_> = fs::read_dir(&path)?
            .map(|entry| {
                Ok(entry?
                    .file_name()
                    .into_string()
                    .map_err(|_| "NON_UTF8_FILE")?)
            })
            .collect::<Result<_>>()?;
        let mut expected = HashSet::new();
        check(
            (2..=3).contains(&candidate.files.len()),
            "CANDIDATE_FILE_BOUND",
        )?;
        for file in &candidate.files {
            check(
                matches!(
                    file.name.as_str(),
                    "manifest.json" | "segment.bin" | "source.json"
                ) && expected.insert(file.name.clone())
                    && hash_text(&file.sha256),
                "CANDIDATE_FILE_INVALID",
            )?;
            encoded_hash(&path.join(&file.name), file.bytes, &file.sha256)?;
        }
        check(
            actual == expected
                && expected.contains("manifest.json")
                && expected.contains("segment.bin"),
            "CANDIDATE_FILE_SET_CHANGED",
        )?;
        let bytes = bounded_bytes(&path.join("manifest.json"), MAX_MANIFEST_BYTES)?;
        let manifest: Manifest = serde_json::from_slice(&bytes)?;
        check(
            manifest.network == current.network && manifest.payload_kind == FULL_KIND,
            "CANDIDATE_NETWORK_OR_KIND_MISMATCH",
        )?;
        candidates.push((manifest.start_height, candidate));
    }
    // Adjacent old single-block segments share one bounded current range reader.
    candidates.sort_by_key(|(start, _)| *start);
    let mut records = OldRecords {
        root,
        catalog: &current,
        store: None,
        reader: None,
        through: 0,
        next: None,
    };
    let mut eligible = Vec::new();
    let mut retained = Vec::new();
    let mut compared = 0u64;
    let mut eligible_bytes = 0u64;
    for (_, candidate) in candidates {
        let path = root.join(&candidate.directory);
        let old = Store::open(&path)?;
        let value = old.manifest();
        let mut matches = value.start_height >= current.start_height
            && value.end_height <= current.head().unwrap();
        if matches {
            for start in (value.start_height..=value.end_height).step_by(1000) {
                for record in old.read_range(start, value.end_height.min(start + 999))? {
                    let record = record?;
                    let replacement = records.read(record.height)?;
                    compared += 1;
                    if record != replacement {
                        matches = false;
                        break;
                    }
                }
                if !matches {
                    break;
                }
            }
        }
        if matches {
            eligible_bytes += candidate.files.iter().map(|f| f.bytes).sum::<u64>();
            eligible.push(candidate);
        } else {
            retained.push(Retained {
                directory: candidate.directory,
                reason: "outside_current_coverage_or_full_record_differs",
            });
        }
    }
    check(
        catalog(&root.join("catalog.json"))?.2 == catalog_hash,
        "CATALOG_CHANGED_DURING_PROOF",
    )?;
    Ok(RetirementProof {
        status: "PASS", scope: "Read-only full-record equivalence; no deletion, reader-quiescence, source freshness or consensus claim.",
        plan_sha256: expected_plan.to_owned(), catalog_file_sha256: catalog_hash,
        catalog_head: current.head().unwrap(), catalog_head_hash: current.head_hash().unwrap().to_owned(),
        catalog_epoch: current.epoch, catalog_revision: current.revision,
        candidates: eligible.len() + retained.len(), records_compared: compared,
        eligible_bytes, eligible, retained, elapsed_seconds: began.elapsed().as_secs_f64(),
    })
}
