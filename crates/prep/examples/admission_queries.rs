//! Opt-in core query timing against independently prepared expected projections.
//! No HTTP, server configuration, writes, ingestion or integrity bypass.
use anyhow::{ensure, Context, Result};
use prep::query::{
    execute_query, validate_query, QueryControl, QueryData, QueryRequest, QueryResponse,
};
use prep_store::{profiling, Archive};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, env, fs, io::Read, path::Path, time::Instant};

const MAX_CASE_BYTES: usize = 8 * 1024 * 1024;
const FORMAT: &str = "prep-admission-query-cases-v1";
const FIELDS: [&str; 8] = [
    "txid",
    "block_height",
    "index",
    "version",
    "locktime",
    "size_bytes",
    "transparent_input_count",
    "transparent_output_count",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Cases {
    format: String,
    oracle_sha256: String,
    archive: ExpectedArchive,
    cases: Vec<Case>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExpectedArchive {
    network: String,
    start_height: u64,
    head: u64,
    head_hash: String,
    epoch: u64,
    revision: u64,
    catalog_sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    name: String,
    request: QueryRequest,
    expected: QueryData,
}
fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn parse_cases(bytes: &[u8]) -> Result<Cases> {
    ensure!(bytes.len() <= MAX_CASE_BYTES, "case input exceeds 8 MiB");
    let cases: Cases = serde_json::from_slice(bytes).context("invalid case document")?;
    ensure!(cases.format == FORMAT, "unsupported case format");
    ensure!(
        is_hash(&cases.oracle_sha256)
            && is_hash(&cases.archive.head_hash)
            && is_hash(&cases.archive.catalog_sha256),
        "invalid input identity hash"
    );
    ensure!(
        cases.archive.start_height > 0 && cases.archive.start_height <= cases.archive.head,
        "invalid archive range"
    );
    ensure!(
        !cases.cases.is_empty() && cases.cases.len() <= 6,
        "require 1 through 6 cases"
    );
    let mut names = HashSet::new();
    for case in &cases.cases {
        ensure!(
            !case.name.is_empty()
                && case.name.len() <= 64
                && case
                    .name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                && names.insert(&case.name),
            "invalid or duplicate case name"
        );
        let request = &case.request;
        validate_query(request)?;
        let to = request.to_block.context("explicit to_block required")?;
        ensure!(
            request.from_block >= cases.archive.start_height
                && request.from_block < to
                && to <= cases.archive.head.checked_add(1).context("head overflow")?
                && to - request.from_block <= 128,
            "case range outside 1 through 128 admitted blocks"
        );
        ensure!(
            request.limit == 128 && request.cursor.is_none(),
            "require limit 128 and no cursor"
        );
        let selected: HashSet<&str> = request
            .field_selection
            .transaction
            .iter()
            .map(String::as_str)
            .collect();
        ensure!(
            request.field_selection.block.is_empty()
                && request.field_selection.transaction.len() == 8
                && selected == FIELDS.into_iter().collect(),
            "exact eight scalar metadata fields required"
        );
        ensure!(
            case.expected.blocks.is_empty(),
            "expected block projection must be empty"
        );
    }
    Ok(cases)
}
fn read_cases(path: &Path) -> Result<Vec<u8>> {
    ensure!(
        fs::symlink_metadata(path)?.file_type().is_file(),
        "case path must be a regular file"
    );
    let file = fs::File::open(path)?;
    ensure!(
        file.metadata()?.len() <= MAX_CASE_BYTES as u64,
        "case input exceeds 8 MiB"
    );
    let mut bytes = Vec::new();
    file.take(MAX_CASE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= MAX_CASE_BYTES, "case file grew beyond 8 MiB");
    Ok(bytes)
}
fn check_archive(archive: &Archive, expected: &ExpectedArchive) -> Result<()> {
    let catalog = archive.catalog();
    ensure!(
        catalog.payload_kind == "full-v1"
            && catalog.network == expected.network
            && catalog.start_height == expected.start_height
            && archive.head() == Some(expected.head)
            && archive.head_hash() == Some(expected.head_hash.as_str())
            && catalog.epoch == expected.epoch
            && catalog.revision == expected.revision
            && catalog.catalog_sha256 == expected.catalog_sha256,
        "archive differs from pinned case identity"
    );
    let header = archive.read_header(expected.head)?;
    let mut protocol_hash = header.hash;
    protocol_hash.reverse();
    ensure!(
        hex::encode(protocol_hash) == expected.head_hash && header.height == expected.head,
        "checked archive head hash differs from oracle case identity"
    );
    Ok(())
}
fn expected_response(case: &Case, expected: &ExpectedArchive) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&QueryResponse {
        archive_height: Some(expected.head),
        network: expected.network.clone(),
        epoch: expected.epoch.to_string(),
        revision: expected.revision.to_string(),
        from_block: case.request.from_block,
        to_block: case.request.to_block.unwrap(),
        next_block: case.request.to_block.unwrap(),
        cursor: None,
        canonicality: "historical_snapshot_not_independently_consensus_validated".into(),
        data: case.expected.clone(),
    })?)
}
fn run_case(
    archive: &Archive,
    case: &Case,
    identity: &ExpectedArchive,
) -> Result<serde_json::Value> {
    let expected = expected_response(case, identity)?;
    let warm = execute_query(archive, &case.request, &QueryControl::default())?;
    ensure!(
        serde_json::to_vec(&warm)? == expected,
        "warmup differs from expected rows/head/counters/range/cursor: {}",
        case.name
    );
    let mut indexed_blocks = 0;
    let mut fallback_blocks = 0;
    for height in case.request.from_block..case.request.to_block.unwrap() {
        if archive.transaction_metadata(height)?.is_some() {
            indexed_blocks += 1;
        } else {
            fallback_blocks += 1;
        }
    }
    let mut samples = Vec::new();
    for _ in 0..5 {
        let control = QueryControl::default();
        let started = Instant::now();
        let response = execute_query(archive, &case.request, &control)?;
        let encoded = serde_json::to_vec(&response)?;
        let elapsed_ns = started.elapsed().as_nanos();
        // Equality and hashes are outside query timing. Exact envelope comparison
        // includes expected head, epoch/revision, cursor and complete range progress.
        ensure!(
            encoded == expected,
            "query differs from independent expected output: {}",
            case.name
        );
        samples.push(json!({"elapsed_ns":elapsed_ns,"response_bytes":encoded.len(),"response_sha256":hash(&encoded)}));
    }
    Ok(
        json!({"name":case.name,"request":case.request,"indexed_blocks":indexed_blocks,"fallback_blocks":fallback_blocks,
        "transactions":case.expected.transactions.len(),"expected_response_sha256":hash(&expected),"samples":samples}),
    )
}
fn main() -> Result<()> {
    let mut args = env::args().skip(1);
    let path = args
        .next()
        .context("Usage: admission_queries ARCHIVE CASES_JSON [ARCHIVE_BUDGET_BYTES]")?;
    let cases_path = args.next().context("missing case JSON path")?;
    let budget = args.next().map(|v| v.parse::<usize>()).transpose()?;
    ensure!(args.next().is_none(), "unexpected argument");
    let raw = read_cases(Path::new(&cases_path))?;
    let cases = parse_cases(&raw)?;
    let (archive, profile) = profiling::open(&path, budget)?;
    check_archive(&archive, &cases.archive)?;
    let mut results = Vec::new();
    for case in &cases.cases {
        results.push(run_case(&archive, case, &cases.archive)?);
    }
    check_archive(&archive, &cases.archive)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "format":"prep-admission-queries-v1","status":"PASS","cases_sha256":hash(&raw),"oracle_sha256":cases.oracle_sha256,
            "catalog_sha256":archive.catalog().catalog_sha256,"head":archive.head(),"head_hash":archive.head_hash(),
            "transaction_index_allocated_bytes":archive.transaction_index_bytes(),"admission_profile":profile,"cases":results,
            "scope":"Core execute_query plus response JSON serialization, sequential one warmup and five samples per case; no HTTP/admission queue/transport timing.",
            "limitations":"Immutable payload integrity is checked during fresh admission at every optional budget. Filesystem cache is uncontrolled and admission warms payloads. Expected cases must be generated independently from the recorded node oracle. This diagnostic verifies supplied expectations, not oracle provenance. Feature-build inactive timer hooks may add overhead to payload fallback; use paired same-binary comparisons only."
        }))?
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> serde_json::Value {
        json!({"format":FORMAT,"oracle_sha256":"a".repeat(64),"archive":{"network":"mainnet","start_height":1,"head":32768,"head_hash":"b".repeat(64),"epoch":0,"revision":128,"catalog_sha256":"c".repeat(64)},
            "cases":[{"name":"first_metadata","request":{"from_block":1,"to_block":129,"limit":128,"field_selection":{"block":[],"transaction":FIELDS}},"expected":{"blocks":[],"transactions":[]}}]})
    }
    fn valid(value: &serde_json::Value) -> bool {
        parse_cases(&serde_json::to_vec(value).unwrap()).is_ok()
    }
    #[test]
    fn accepts_narrow_case_format_and_exact_expected_envelope() {
        let cases = parse_cases(&serde_json::to_vec(&input()).unwrap()).unwrap();
        assert_eq!(cases.cases.len(), 1);
        let response: QueryResponse =
            serde_json::from_slice(&expected_response(&cases.cases[0], &cases.archive).unwrap())
                .unwrap();
        assert_eq!(response.next_block, 129);
        assert!(response.cursor.is_none());
        assert_eq!(response.archive_height, Some(32768));
    }
    #[test]
    fn rejects_case_format_count_ranges_and_payload_fields() {
        let mut v = input();
        v["format"] = json!("unknown");
        assert!(!valid(&v));
        let mut v = input();
        v["cases"] = json!(vec![v["cases"][0].clone(); 7]);
        assert!(!valid(&v));
        let mut v = input();
        v["cases"][0]["request"]["to_block"] = json!(130);
        assert!(!valid(&v));
        let mut v = input();
        v["cases"][0]["request"]["to_block"] = serde_json::Value::Null;
        assert!(!valid(&v));
        let mut v = input();
        v["cases"][0]["request"]["field_selection"]["transaction"][0] = json!("decoded");
        assert!(!valid(&v));
        let mut v = input();
        v["output_path"] = json!("/tmp/arbitrary");
        assert!(!valid(&v));
        assert!(parse_cases(&vec![b' '; MAX_CASE_BYTES + 1]).is_err());
    }
}
