//! Bounded public-ID lookup on one immutable archive snapshot. No private keys.
use crate::query::{
    execute_query, validate_query, FieldSelection, QueryArchive, QueryControl, QueryError,
    QueryRequest, TransactionFilter,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    io::{self, Write},
    sync::atomic::Ordering,
    time::Instant,
};

pub(crate) const MAX_LOOKUP_IDS: usize = 128;
pub(crate) const MAX_LOOKUP_BLOCKS: u64 = 10_000;
pub(crate) const MAX_LOOKUP_RECORDS: usize = 4096;
pub(crate) const MAX_LOOKUP_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const DEFAULT_LOOKUP_FIELDS: &[&str] = &[
    "txid",
    "block_height",
    "index",
    "version",
    "locktime",
    "size_bytes",
    "transparent_input_count",
    "transparent_output_count",
];
pub(crate) const REQUIRED_LOOKUP_FIELDS: &[&str] = &["txid", "block_height", "index"];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub network: String,
    pub archive_start: u64,
    pub to_block: u64,
    pub epoch: String,
    pub boundary_hash: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransactionRequest {
    pub from_block: u64,
    pub to_block: u64,
    pub txids: Vec<String>,
    #[serde(default = "default_fields")]
    pub fields: Vec<String>,
    pub at: Option<Snapshot>,
}
fn default_fields() -> Vec<String> {
    DEFAULT_LOOKUP_FIELDS
        .iter()
        .map(|field| (*field).into())
        .collect()
}
#[derive(Debug, Serialize)]
pub struct TransactionResponse {
    pub network: String,
    pub epoch: String,
    pub revision: String,
    pub archive_height: Option<u64>,
    pub from_block: u64,
    pub to_block: u64,
    pub snapshot: Snapshot,
    pub complete: bool,
    pub transactions: Vec<Value>,
    pub missing_txids: Vec<String>,
}
fn page_request(request: &TransactionRequest) -> QueryRequest {
    QueryRequest {
        from_block: request.from_block,
        to_block: Some(request.to_block),
        limit: 1000,
        scan_mode: None,
        field_selection: FieldSelection {
            block: vec![],
            transaction: request.fields.clone(),
        },
        transaction_filter: TransactionFilter {
            txids: Some(request.txids.clone()),
            ..Default::default()
        },
        cursor: None,
    }
}
fn hex_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
pub fn validate_transactions(request: &TransactionRequest) -> Result<(), QueryError> {
    if request.to_block < request.from_block
        || request.to_block - request.from_block > MAX_LOOKUP_BLOCKS
        || request.txids.len() > MAX_LOOKUP_IDS
    {
        return Err(QueryError::new(400, "INVALID_LOOKUP_BOUNDS"));
    }
    validate_query(&page_request(request))?;
    if REQUIRED_LOOKUP_FIELDS
        .iter()
        .any(|required| !request.fields.iter().any(|field| field == required))
    {
        return Err(QueryError::new(400, "LOOKUP_IDENTITY_FIELDS_REQUIRED"));
    }
    if let Some(snapshot) = &request.at {
        let epoch = snapshot.epoch.parse::<u64>().ok();
        if epoch.is_none_or(|epoch| epoch.to_string() != snapshot.epoch)
            || (!snapshot.boundary_hash.is_empty() && !hex_id(&snapshot.boundary_hash))
        {
            return Err(QueryError::new(400, "INVALID_LOOKUP_SNAPSHOT"));
        }
    }
    Ok(())
}
fn boundary<A: QueryArchive>(archive: &A, to: u64) -> Result<String, QueryError> {
    let meta = archive.query_meta();
    if to == meta.start_height {
        return Ok(String::new());
    }
    let header = archive.query_header(to - 1)?;
    if header.height != to - 1 || header.hash.len() != 32 {
        return Err(QueryError::new(503, "INVALID_STORED_BLOCK"));
    }
    Ok(hex::encode(
        header.hash.iter().rev().copied().collect::<Vec<_>>(),
    ))
}
/// Invoke before checking source readiness, so a stale pinned prefix is a conflict.
pub fn check_snapshot<A: QueryArchive>(
    archive: &A,
    request: &TransactionRequest,
) -> Result<(), QueryError> {
    let Some(snapshot) = &request.at else {
        return Ok(());
    };
    let meta = archive.query_meta();
    if snapshot.network != meta.network
        || snapshot.archive_start != meta.start_height
        || snapshot.to_block != request.to_block
    {
        return Err(QueryError::new(409, "LOOKUP_SNAPSHOT_MISMATCH"));
    }
    if snapshot.epoch != meta.epoch.to_string()
        || request.to_block > meta.head.map_or(meta.start_height, |height| height + 1)
        || request.to_block < meta.start_height
    {
        return Err(QueryError::new(409, "REORG"));
    }
    if snapshot.boundary_hash != boundary(archive, request.to_block)? {
        return Err(QueryError::new(409, "REORG"));
    }
    Ok(())
}
fn check_control(control: &QueryControl) -> Result<(), QueryError> {
    if control.cancelled.load(Ordering::Acquire) || Instant::now() >= control.deadline {
        Err(QueryError::new(408, "QUERY_CANCELLED_OR_TIMED_OUT"))
    } else {
        Ok(())
    }
}
struct BoundedWriter<'a> {
    bytes: Vec<u8>,
    count: usize,
    limit: usize,
    control: &'a QueryControl,
    retain: bool,
}
impl Write for BoundedWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        check_control(self.control).map_err(io::Error::other)?;
        if bytes.len() > self.limit.saturating_sub(self.count) {
            return Err(io::Error::other("lookup response limit"));
        }
        self.count += bytes.len();
        if self.retain {
            self.bytes.extend_from_slice(bytes);
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn encode<'a, T: Serialize>(
    value: &T,
    control: &'a QueryControl,
    retain: bool,
) -> Result<BoundedWriter<'a>, QueryError> {
    let mut writer = BoundedWriter {
        bytes: vec![],
        count: 0,
        limit: control.max_response_bytes.min(MAX_LOOKUP_BYTES),
        control,
        retain,
    };
    if serde_json::to_writer(&mut writer, value).is_err() {
        check_control(control)?;
        return Err(QueryError::new(413, "LOOKUP_RESPONSE_TOO_LARGE"));
    }
    Ok(writer)
}
pub fn encode_response(
    response: &TransactionResponse,
    control: &QueryControl,
) -> Result<Vec<u8>, QueryError> {
    Ok(encode(response, control, true)?.bytes)
}
pub fn execute_transactions<A: QueryArchive>(
    archive: &A,
    request: &TransactionRequest,
    control: &QueryControl,
) -> Result<TransactionResponse, QueryError> {
    validate_transactions(request)?;
    check_control(control)?;
    check_snapshot(archive, request)?;
    let meta = archive.query_meta();
    if meta.payload_kind != "full-v1" {
        return Err(QueryError::new(409, "FULL_BLOCK_ARCHIVE_REQUIRED"));
    }
    if request.from_block < meta.start_height
        || request.to_block > meta.head.map_or(meta.start_height, |height| height + 1)
    {
        return Err(QueryError::new(416, "RANGE_OUTSIDE_INDEXED_ARCHIVE"));
    }
    let mut unique = HashSet::new();
    let missing: Vec<String> = request
        .txids
        .iter()
        .filter(|id| unique.insert((*id).clone()))
        .cloned()
        .collect();
    let snapshot = Snapshot {
        network: meta.network.clone(),
        archive_start: meta.start_height,
        to_block: request.to_block,
        epoch: meta.epoch.to_string(),
        boundary_hash: boundary(archive, request.to_block)?,
    };
    let mut response = TransactionResponse {
        network: meta.network,
        epoch: meta.epoch.to_string(),
        revision: meta.revision.to_string(),
        archive_height: meta.head,
        from_block: request.from_block,
        to_block: request.to_block,
        snapshot,
        complete: true,
        transactions: vec![],
        missing_txids: missing,
    };
    let mut total_bytes = encode(&response, control, false)?.count;
    if request.txids.is_empty() || request.from_block == request.to_block {
        return Ok(response);
    }
    let mut page = page_request(request);
    let page_control = QueryControl {
        cancelled: control.cancelled.clone(),
        deadline: control.deadline,
        max_response_bytes: control.max_response_bytes.min(MAX_LOOKUP_BYTES),
    };
    let mut next = request.from_block;
    let mut previous = None;
    loop {
        check_control(control)?;
        let result = execute_query(archive, &page, &page_control)?;
        if result.next_block <= next
            || result.next_block > request.to_block
            || result.to_block != request.to_block
        {
            return Err(QueryError::new(503, "INCOMPLETE_LOOKUP_PAGE"));
        }
        for row in result.data.transactions {
            check_control(control)?;
            if response.transactions.len() >= MAX_LOOKUP_RECORDS {
                return Err(QueryError::new(413, "LOOKUP_TOO_MANY_RECORDS"));
            }
            let id = row
                .get("txid")
                .and_then(Value::as_str)
                .ok_or_else(|| QueryError::new(503, "INVALID_LOOKUP_ROW"))?;
            let height = row
                .get("block_height")
                .and_then(Value::as_u64)
                .ok_or_else(|| QueryError::new(503, "INVALID_LOOKUP_ROW"))?;
            let index = row
                .get("index")
                .and_then(Value::as_u64)
                .filter(|index| *index <= u64::from(u32::MAX))
                .ok_or_else(|| QueryError::new(503, "INVALID_LOOKUP_ROW"))?;
            if !unique.contains(id)
                || !hex_id(id)
                || height < next
                || height >= result.next_block
                || previous.is_some_and(|previous| previous >= (height, index))
            {
                return Err(QueryError::new(503, "INVALID_LOOKUP_ROW"));
            }
            previous = Some((height, index));
            let missing_before = encode(&response.missing_txids, control, false)?.count;
            response.missing_txids.retain(|missing| missing != id);
            let missing_after = encode(&response.missing_txids, control, false)?.count;
            let row_bytes = encode(&row, control, false)?.count;
            total_bytes = total_bytes
                .checked_sub(missing_before - missing_after)
                .and_then(|bytes| {
                    bytes.checked_add(row_bytes + usize::from(!response.transactions.is_empty()))
                })
                .ok_or_else(|| QueryError::new(413, "LOOKUP_RESPONSE_TOO_LARGE"))?;
            if total_bytes > control.max_response_bytes.min(MAX_LOOKUP_BYTES) {
                return Err(QueryError::new(413, "LOOKUP_RESPONSE_TOO_LARGE"));
            }
            response.transactions.push(row);
        }
        next = result.next_block;
        if next == request.to_block {
            if result.cursor.is_some() {
                return Err(QueryError::new(503, "INCOMPLETE_LOOKUP_PAGE"));
            }
            break;
        }
        page.cursor = Some(
            result
                .cursor
                .ok_or_else(|| QueryError::new(503, "INCOMPLETE_LOOKUP_PAGE"))?,
        );
    }
    check_control(control)?;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::QueryMeta;
    use prep_proto::prep::FullBlock;
    use prep_store::{BlockHeader, BlockRecord};
    use prost::Message;
    use serde_json::json;
    struct Fixture {
        head: u64,
        epoch: u64,
        boundary: u8,
        blocks: Vec<BlockRecord>,
    }
    impl QueryArchive for Fixture {
        fn query_meta(&self) -> QueryMeta {
            QueryMeta {
                network: "regtest".into(),
                start_height: 1,
                head: Some(self.head),
                epoch: self.epoch,
                revision: self.head,
                payload_kind: "full-v1".into(),
            }
        }
        fn query_block(&self, height: u64) -> Result<BlockRecord, QueryError> {
            self.blocks
                .iter()
                .find(|block| block.height == height)
                .cloned()
                .ok_or_else(|| QueryError::new(503, "ARCHIVE_READ_FAILED"))
        }
        fn query_header(&self, height: u64) -> Result<BlockHeader, QueryError> {
            Ok(BlockHeader {
                height,
                hash: vec![
                    if height == 3 {
                        self.boundary
                    } else {
                        height as u8
                    };
                    32
                ],
                prev_hash: vec![height.saturating_sub(1) as u8; 32],
                time: 1,
            })
        }
    }
    fn fixture(count: usize) -> Fixture {
        let mut blocks = vec![];
        for height in 1..=3 {
            let rows: Vec<Value> = (0..count).map(|_| json!({"txid":"11".repeat(32),"hex":"0102","version":1,"locktime":0,"vin":[{}],"vout":[{}]})).collect();
            let block = FullBlock {
                height,
                hash: vec![height as u8; 32],
                prev_hash: vec![height as u8 - 1; 32],
                time: 1,
                raw_block: vec![1],
                decoded_json: json!({"tx":rows}).to_string(),
            };
            blocks.push(BlockRecord {
                height,
                hash: block.hash.clone(),
                prev_hash: block.prev_hash.clone(),
                payload: block.encode_to_vec(),
            });
        }
        Fixture {
            head: 3,
            epoch: 0,
            boundary: 3,
            blocks,
        }
    }
    fn request() -> TransactionRequest {
        TransactionRequest {
            from_block: 1,
            to_block: 4,
            txids: vec![
                "11".repeat(32),
                "22".repeat(32),
                "11".repeat(32),
                "33".repeat(32),
                "22".repeat(32),
            ],
            fields: default_fields(),
            at: None,
        }
    }
    #[test]
    fn duplicates_multiple_locations_missing_and_legacy_fallback_are_complete() {
        let response =
            execute_transactions(&fixture(2), &request(), &QueryControl::default()).unwrap();
        assert!(response.complete);
        assert_eq!(response.transactions.len(), 6);
        assert_eq!(
            response
                .transactions
                .iter()
                .map(|row| (
                    row["block_height"].as_u64().unwrap(),
                    row["index"].as_u64().unwrap()
                ))
                .collect::<Vec<_>>(),
            [(1, 0), (1, 1), (2, 0), (2, 1), (3, 0), (3, 1)]
        );
        assert_eq!(response.missing_txids, ["22".repeat(32), "33".repeat(32)]);
        let mut empty = request();
        empty.txids.clear();
        assert!(
            execute_transactions(&fixture(2), &empty, &QueryControl::default())
                .unwrap()
                .transactions
                .is_empty()
        );
        empty = request();
        empty.to_block = 1;
        let response = execute_transactions(&fixture(2), &empty, &QueryControl::default()).unwrap();
        assert_eq!(response.snapshot.boundary_hash, "");
        assert_eq!(response.missing_txids.len(), 3);
    }
    #[test]
    fn malformed_request_shapes_fields_and_bounds_are_rejected() {
        for id in ["bad".into(), "AB".repeat(32), "gg".repeat(32)] {
            let mut invalid = request();
            invalid.txids = vec![id];
            assert!(validate_transactions(&invalid).is_err());
        }
        let mut invalid = request();
        invalid.txids = vec!["11".repeat(32); 129];
        assert!(validate_transactions(&invalid).is_err());
        invalid = request();
        invalid.to_block = 10002;
        assert!(validate_transactions(&invalid).is_err());
        invalid = request();
        invalid.to_block = 0;
        assert!(validate_transactions(&invalid).is_err());
        invalid = request();
        invalid.fields = vec!["txid".into()];
        assert!(validate_transactions(&invalid).is_err());
        invalid = request();
        invalid.fields.push("txid".into());
        assert!(validate_transactions(&invalid).is_err());
        invalid = request();
        invalid.fields.push("unknown".into());
        assert!(validate_transactions(&invalid).is_err());
        assert!(
            serde_json::from_value::<TransactionRequest>(json!({"from_block":1,"txids":[]}))
                .is_err()
        );
    }
    #[test]
    fn snapshot_append_is_safe_but_epoch_boundary_or_identity_conflicts_are_not() {
        let source = fixture(1);
        let mut request = request();
        request.at = Some(
            execute_transactions(&source, &request, &QueryControl::default())
                .unwrap()
                .snapshot,
        );
        let mut changed = fixture(1);
        changed.head = 4;
        assert!(execute_transactions(&changed, &request, &QueryControl::default()).is_ok());
        changed.epoch = 1;
        assert_eq!(
            check_snapshot(&changed, &request).unwrap_err().code,
            "REORG"
        );
        changed.epoch = 0;
        changed.boundary = 99;
        assert_eq!(
            check_snapshot(&changed, &request).unwrap_err().code,
            "REORG"
        );
        changed.boundary = 3;
        request.at.as_mut().unwrap().network = "mainnet".into();
        assert_eq!(
            check_snapshot(&changed, &request).unwrap_err().code,
            "LOOKUP_SNAPSHOT_MISMATCH"
        );
        request.at.as_mut().unwrap().network = "regtest".into();
        request.at.as_mut().unwrap().epoch = "00".into();
        assert!(validate_transactions(&request).is_err());
    }
    #[test]
    fn row_byte_cancellation_and_read_failures_never_report_missing_success() {
        assert_eq!(
            execute_transactions(&fixture(1366), &request(), &QueryControl::default())
                .unwrap_err()
                .code,
            "LOOKUP_TOO_MANY_RECORDS"
        );
        let response =
            execute_transactions(&fixture(1), &request(), &QueryControl::default()).unwrap();
        let control = QueryControl::default();
        let bytes = encode_response(&response, &control).unwrap();
        let exact = QueryControl {
            max_response_bytes: bytes.len(),
            ..Default::default()
        };
        assert_eq!(
            encode_response(&response, &exact).unwrap().len(),
            bytes.len()
        );
        let short = QueryControl {
            max_response_bytes: bytes.len() - 1,
            ..Default::default()
        };
        assert_eq!(
            encode_response(&response, &short).unwrap_err().code,
            "LOOKUP_RESPONSE_TOO_LARGE"
        );
        control.cancelled.store(true, Ordering::Release);
        assert_eq!(
            execute_transactions(&fixture(1), &request(), &control)
                .unwrap_err()
                .status,
            408
        );
        let mut incomplete = fixture(1);
        incomplete.blocks.pop();
        assert_eq!(
            execute_transactions(&incomplete, &request(), &QueryControl::default())
                .unwrap_err()
                .status,
            503
        );
    }

    #[test]
    fn lookup_drains_multiple_bounded_pages_without_false_missing_or_duplicate_rows() {
        let mut source = fixture(1);
        for height in 4..=2002 {
            let mut full = FullBlock::decode(source.blocks[0].payload.as_slice()).unwrap();
            full.height = height;
            full.hash = vec![height as u8; 32];
            full.prev_hash = vec![(height - 1) as u8; 32];
            source.blocks.push(BlockRecord {
                height,
                hash: full.hash.clone(),
                prev_hash: full.prev_hash.clone(),
                payload: full.encode_to_vec(),
            });
        }
        source.head = 2002;
        let mut request = request();
        request.to_block = 2003;
        let response = execute_transactions(&source, &request, &QueryControl::default()).unwrap();
        assert!(response.complete);
        assert_eq!(response.transactions.len(), 2002);
        assert_eq!(response.transactions.first().unwrap()["block_height"], 1);
        assert_eq!(response.transactions.last().unwrap()["block_height"], 2002);
        assert_eq!(response.missing_txids, ["22".repeat(32), "33".repeat(32)]);
        let mut late_failure = source;
        late_failure.blocks.pop();
        assert_eq!(
            execute_transactions(&late_failure, &request, &QueryControl::default())
                .unwrap_err()
                .status,
            503
        );
    }
}
