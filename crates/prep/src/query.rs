//! Bounded historical full-block queries. All nested node-JSON numbers are strings.
use std::{
    collections::HashSet,
    io::{self, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use prep_proto::prep::FullBlock;
use prep_store::{Archive, BlockHeader, BlockRecord};
use prost::Message;
use serde::{ser::SerializeMap, ser::SerializeSeq, Deserialize, Serialize, Serializer};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

pub const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_SCAN_BLOCKS: u32 = 1000;
pub const MAX_CURSOR_BYTES: usize = 2048;
const RESPONSE_OVERHEAD: usize = 4096;
const EMPTY_DATA_BYTES: usize = br#"{"blocks":[],"transactions":[]}"#.len();
const BLOCK_FIELDS: &[&str] = &["height", "hash", "previous_hash", "time", "raw", "decoded"];
const TX_FIELDS: &[&str] = &[
    "txid",
    "block_height",
    "index",
    "version",
    "locktime",
    "raw",
    "vin",
    "vout",
    "decoded",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldSelection {
    #[serde(default = "default_block_fields")]
    pub block: Vec<String>,
    #[serde(default = "default_tx_fields")]
    pub transaction: Vec<String>,
}
fn default_block_fields() -> Vec<String> {
    ["height", "hash", "previous_hash", "time"]
        .map(String::from)
        .to_vec()
}
fn default_tx_fields() -> Vec<String> {
    ["txid", "block_height", "index", "version", "locktime"]
        .map(String::from)
        .to_vec()
}
impl Default for FieldSelection {
    fn default() -> Self {
        Self {
            block: default_block_fields(),
            transaction: default_tx_fields(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransactionFilter {
    /// OR within a list; AND between filter properties. Empty lists match nothing.
    pub txids: Option<Vec<String>>,
    pub versions: Option<Vec<u32>>,
    pub has_sapling: Option<bool>,
    pub has_orchard: Option<bool>,
    pub transparent_output_addresses: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueryRequest {
    pub from_block: u64,
    /// Exclusive. If omitted, the first page captures the indexed head + 1.
    pub to_block: Option<u64>,
    #[serde(default = "default_limit")]
    pub limit: u32,
    #[serde(default)]
    pub field_selection: FieldSelection,
    #[serde(default)]
    pub transaction_filter: TransactionFilter,
    pub cursor: Option<String>,
}
fn default_limit() -> u32 {
    100
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct QueryData {
    pub blocks: Vec<Value>,
    pub transactions: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueryResponse {
    pub archive_height: Option<u64>,
    pub network: String,
    /// Opaque decimal strings, preserving the storage counter without JS rounding.
    pub epoch: String,
    pub revision: String,
    pub from_block: u64,
    pub to_block: u64,
    pub next_block: u64,
    pub cursor: Option<String>,
    pub canonicality: String,
    pub data: QueryData,
}

#[derive(Clone, Debug)]
pub struct QueryMeta {
    pub network: String,
    pub start_height: u64,
    pub head: Option<u64>,
    pub epoch: u64,
    pub revision: u64,
    pub payload_kind: String,
}

/// Keeps query semantics independently testable without modifying persistent data.
pub trait QueryArchive {
    fn query_meta(&self) -> QueryMeta;
    fn query_block(&self, height: u64) -> Result<BlockRecord, QueryError>;
    /// Inclusive range; production archives reuse a segment handle across blocks.
    fn query_range(
        &self,
        start: u64,
        end: u64,
    ) -> Result<Box<dyn Iterator<Item = Result<BlockRecord, QueryError>> + '_>, QueryError> {
        Ok(Box::new(
            (start..=end).map(|height| self.query_block(height)),
        ))
    }
    fn query_header(&self, height: u64) -> Result<BlockHeader, QueryError> {
        let record = self.query_block(height)?;
        let block = FullBlock::decode(record.payload.as_slice())
            .map_err(|_| QueryError::new(503, "INVALID_STORED_BLOCK"))?;
        if block.height != record.height
            || block.hash != record.hash
            || block.prev_hash != record.prev_hash
        {
            return Err(QueryError::new(503, "INVALID_STORED_BLOCK"));
        }
        Ok(BlockHeader {
            height: block.height,
            hash: block.hash,
            prev_hash: block.prev_hash,
            time: block.time,
        })
    }
}
impl QueryArchive for Archive {
    fn query_meta(&self) -> QueryMeta {
        let catalog = self.catalog();
        QueryMeta {
            network: catalog.network.clone(),
            start_height: catalog.start_height,
            head: self.head(),
            epoch: catalog.epoch,
            revision: catalog.revision,
            payload_kind: catalog.payload_kind.clone(),
        }
    }
    fn query_block(&self, height: u64) -> Result<BlockRecord, QueryError> {
        self.read_block(height)
            .map_err(|_| QueryError::new(503, "ARCHIVE_READ_FAILED"))
    }
    fn query_header(&self, height: u64) -> Result<BlockHeader, QueryError> {
        self.read_header(height)
            .map_err(|_| QueryError::new(503, "ARCHIVE_READ_FAILED"))
    }
    fn query_range(
        &self,
        start: u64,
        end: u64,
    ) -> Result<Box<dyn Iterator<Item = Result<BlockRecord, QueryError>> + '_>, QueryError> {
        let reader = self
            .read_range(start, end)
            .map_err(|_| QueryError::new(503, "ARCHIVE_READ_FAILED"))?;
        Ok(Box::new(reader.map(|record| {
            record.map_err(|_| QueryError::new(503, "ARCHIVE_READ_FAILED"))
        })))
    }
}

#[derive(Clone, Debug)]
pub struct QueryError {
    pub status: u16,
    pub code: &'static str,
}
impl QueryError {
    pub fn new(status: u16, code: &'static str) -> Self {
        Self { status, code }
    }
}
impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code)
    }
}
impl std::error::Error for QueryError {}

pub struct QueryControl {
    pub cancelled: Arc<AtomicBool>,
    pub deadline: Instant,
    pub max_response_bytes: usize,
}
impl Default for QueryControl {
    fn default() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            deadline: Instant::now() + Duration::from_secs(30),
            max_response_bytes: MAX_RESPONSE_BYTES,
        }
    }
}
impl QueryControl {
    fn check(&self) -> Result<(), QueryError> {
        if self.cancelled.load(Ordering::Acquire) || Instant::now() >= self.deadline {
            Err(QueryError::new(408, "QUERY_CANCELLED_OR_TIMED_OUT"))
        } else {
            Ok(())
        }
    }
}

/// Count the exact JSON wire size without allocating a second response buffer.
/// A hard limit also stops traversal of a large rejected projection early.
fn encoded_size<T: Serialize + ?Sized>(
    value: &T,
    limit: usize,
    control: &QueryControl,
) -> Result<Option<usize>, QueryError> {
    struct Counter<'a> {
        bytes: usize,
        next_check: usize,
        limit: usize,
        exceeded: bool,
        control: &'a QueryControl,
    }
    impl Write for Counter<'_> {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if self.bytes.saturating_add(bytes.len()) >= self.next_check {
                self.control.check().map_err(io::Error::other)?;
                self.next_check = self.bytes.saturating_add(bytes.len()).saturating_add(65536);
            }
            if bytes.len() > self.limit - self.bytes {
                self.exceeded = true;
                return Err(io::Error::other("JSON size limit exceeded"));
            }
            self.bytes += bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter {
        bytes: 0,
        next_check: 0,
        limit,
        exceeded: false,
        control,
    };
    let result = serde_json::to_writer(&mut counter, value);
    control.check()?;
    if counter.exceeded {
        Ok(None)
    } else {
        result.map_err(|_| QueryError::new(500, "RESPONSE_ENCODING_FAILED"))?;
        Ok(Some(counter.bytes))
    }
}

/// Borrowed equivalent of lossless_node_json for sizing before copying a subtree.
struct LosslessNode<'a>(&'a Value);
impl Serialize for LosslessNode<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Value::Number(number) => serializer.serialize_str(&number.to_string()),
            Value::Array(values) => {
                let mut sequence = serializer.serialize_seq(Some(values.len()))?;
                for value in values {
                    sequence.serialize_element(&LosslessNode(value))?;
                }
                sequence.end()
            }
            Value::Object(values) => {
                let mut map = serializer.serialize_map(Some(values.len()))?;
                for (key, value) in values {
                    map.serialize_entry(key, &LosslessNode(value))?;
                }
                map.end()
            }
            value => value.serialize(serializer),
        }
    }
}

enum ProjectedValue<'a> {
    Owned(Value),
    Node(&'a Value),
    RawBytes(&'a [u8]),
    HexText(&'a str),
}

const BLOCK_TOO_LARGE: &str = "BLOCK_RESPONSE_TOO_LARGE_USE_FIELD_SELECTION";
fn block_too_large() -> QueryError {
    QueryError::new(413, BLOCK_TOO_LARGE)
}

/// Exact size of the per-block QueryData wrapper, including both array commas.
/// Keep the existing page accounting (a wrapper per block) intentionally intact.
struct ProjectionBudget<'a> {
    bytes: usize,
    limit: usize,
    control: &'a QueryControl,
}
impl<'a> ProjectionBudget<'a> {
    fn new(limit: usize, control: &'a QueryControl) -> Result<Self, QueryError> {
        let bytes = EMPTY_DATA_BYTES;
        if bytes > limit {
            return Err(block_too_large());
        }
        Ok(Self {
            bytes,
            limit,
            control,
        })
    }
    fn reserve(&mut self, bytes: usize) -> Result<(), QueryError> {
        if bytes > self.limit - self.bytes {
            return Err(block_too_large());
        }
        self.bytes += bytes;
        Ok(())
    }
    fn object(&mut self, preceding_items: bool) -> Result<(), QueryError> {
        self.reserve(2 + usize::from(preceding_items))
    }
    fn insert(
        &mut self,
        selected: &mut Map<String, Value>,
        field: &str,
        value: ProjectedValue<'_>,
    ) -> Result<(), QueryError> {
        // Validated field names contain only ASCII letters and underscores.
        self.reserve(field.len() + 3 + usize::from(!selected.is_empty()))?;
        let remaining = self.limit - self.bytes;
        let size = match &value {
            ProjectedValue::Owned(value) => encoded_size(value, remaining, self.control)?,
            ProjectedValue::Node(value) => {
                encoded_size(&LosslessNode(value), remaining, self.control)?
            }
            ProjectedValue::RawBytes(bytes) => {
                bytes.len().checked_mul(2).and_then(|n| n.checked_add(2))
            }
            ProjectedValue::HexText(text) => text.len().checked_add(2),
        }
        .ok_or_else(block_too_large)?;
        self.reserve(size)?;
        let value = match value {
            ProjectedValue::Owned(value) => value,
            ProjectedValue::Node(value) => lossless_node_json(value),
            ProjectedValue::RawBytes(bytes) => Value::String(hex::encode(bytes)),
            ProjectedValue::HexText(text) => Value::String(text.to_ascii_lowercase()),
        };
        selected.insert(field.into(), value);
        Ok(())
    }
}

/// The per-block size includes an empty QueryData wrapper. When combining pages,
/// only the array contents and a comma between nonempty groups are added.
fn appended_data_bytes(
    current: &QueryData,
    selected: &QueryData,
    selected_bytes: usize,
) -> Result<usize, QueryError> {
    selected_bytes
        .checked_sub(EMPTY_DATA_BYTES)
        .and_then(|bytes| {
            bytes.checked_add(usize::from(
                !current.blocks.is_empty() && !selected.blocks.is_empty(),
            ))
        })
        .and_then(|bytes| {
            bytes.checked_add(usize::from(
                !current.transactions.is_empty() && !selected.transactions.is_empty(),
            ))
        })
        .ok_or_else(|| QueryError::new(500, "RESPONSE_ENCODING_FAILED"))
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    v: u8,
    network: String,
    archive_start: u64,
    epoch: u64,
    from: u64,
    to: u64,
    next: u64,
    fingerprint: String,
    boundary_hash: String,
}
fn fingerprint(request: &QueryRequest, to: u64) -> Result<String, QueryError> {
    let bytes = serde_json::to_vec(&(
        request.from_block,
        to,
        request.limit,
        &request.field_selection,
        &request.transaction_filter,
    ))
    .map_err(|_| QueryError::new(400, "INVALID_QUERY"))?;
    Ok(hex::encode(Sha256::digest(bytes)))
}
fn decode_cursor(value: &str) -> Result<Cursor, QueryError> {
    if value.len() > MAX_CURSOR_BYTES * 2 || !value.len().is_multiple_of(2) {
        return Err(QueryError::new(400, "INVALID_CURSOR"));
    }
    let bytes = hex::decode(value).map_err(|_| QueryError::new(400, "INVALID_CURSOR"))?;
    serde_json::from_slice(&bytes).map_err(|_| QueryError::new(400, "INVALID_CURSOR"))
}

pub fn check_cursor_epoch(request: &QueryRequest, meta: &QueryMeta) -> Result<(), QueryError> {
    if let Some(value) = &request.cursor {
        if decode_cursor(value)?.epoch != meta.epoch {
            return Err(QueryError::new(409, "REORG"));
        }
    }
    Ok(())
}

pub fn validate_query(request: &QueryRequest) -> Result<(), QueryError> {
    if request.from_block > u64::from(u32::MAX)
        || request
            .to_block
            .is_some_and(|to| to > u64::from(u32::MAX) + 1 || to < request.from_block)
        || request.limit == 0
        || request.limit > MAX_SCAN_BLOCKS
    {
        return Err(QueryError::new(400, "INVALID_QUERY_RANGE_OR_LIMIT"));
    }
    for (selected, allowed) in [
        (&request.field_selection.block, BLOCK_FIELDS),
        (&request.field_selection.transaction, TX_FIELDS),
    ] {
        let mut distinct = HashSet::new();
        if selected.len() > allowed.len()
            || selected
                .iter()
                .any(|field| !allowed.contains(&field.as_str()) || !distinct.insert(field))
        {
            return Err(QueryError::new(400, "UNSUPPORTED_OR_DUPLICATE_FIELD"));
        }
    }
    if let Some(ids) = &request.transaction_filter.txids {
        if ids.len() > 128
            || ids.iter().any(|id| {
                id.len() != 64
                    || !id
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
        {
            return Err(QueryError::new(400, "INVALID_TXID_FILTER"));
        }
    }
    if request
        .transaction_filter
        .versions
        .as_ref()
        .is_some_and(|versions| versions.len() > 128)
    {
        return Err(QueryError::new(400, "INVALID_VERSION_FILTER"));
    }
    if let Some(addresses) = &request.transaction_filter.transparent_output_addresses {
        if addresses.len() > 64
            || addresses.iter().any(|address| {
                address.is_empty()
                    || address.len() > 128
                    || !address.starts_with('t')
                    || !address.bytes().all(|byte| byte.is_ascii_alphanumeric())
            })
        {
            return Err(QueryError::new(
                400,
                "INVALID_TRANSPARENT_OUTPUT_ADDRESS_FILTER",
            ));
        }
    }
    if let Some(cursor) = &request.cursor {
        decode_cursor(cursor)?;
    }
    Ok(())
}

/// Preserve every node JSON numeric token as a decimal string. Do not deserialize
/// economic fields through f64. serde_json's arbitrary_precision feature is required.
pub fn lossless_node_json(value: &Value) -> Value {
    match value {
        Value::Number(number) => Value::String(number.to_string()),
        Value::Array(values) => Value::Array(values.iter().map(lossless_node_json).collect()),
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| (key.clone(), lossless_node_json(value)))
                .collect(),
        ),
        other => other.clone(),
    }
}
fn node_u32(tx: &Value, key: &str) -> Result<u32, QueryError> {
    tx.get(key)
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(|| QueryError::new(503, "INVALID_STORED_TRANSACTION"))
}
fn hex_field(value: &Value, key: &str, exact_bytes: Option<usize>) -> Result<String, QueryError> {
    Ok(valid_hex_field(value, key, exact_bytes)?.to_ascii_lowercase())
}
fn valid_hex_field<'a>(
    value: &'a Value,
    key: &str,
    exact_bytes: Option<usize>,
) -> Result<&'a str, QueryError> {
    let text = value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| QueryError::new(503, "INVALID_STORED_TRANSACTION"))?;
    if text.is_empty()
        || !text.len().is_multiple_of(2)
        || exact_bytes.is_some_and(|size| text.len() != size * 2)
        || !text.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(QueryError::new(503, "INVALID_STORED_TRANSACTION"));
    }
    Ok(text)
}
fn has_array(value: Option<&Value>) -> Result<bool, QueryError> {
    match value {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Array(values)) => Ok(!values.is_empty()),
        _ => Err(QueryError::new(503, "INVALID_STORED_TRANSACTION")),
    }
}
fn matches_tx(tx: &Value, filter: &TransactionFilter) -> Result<bool, QueryError> {
    if let Some(ids) = &filter.txids {
        if !ids.contains(&hex_field(tx, "txid", Some(32))?) {
            return Ok(false);
        }
    }
    if let Some(versions) = &filter.versions {
        if !versions.contains(&node_u32(tx, "version")?) {
            return Ok(false);
        }
    }
    if let Some(wanted) = filter.has_sapling {
        let actual = has_array(tx.get("vShieldedSpend"))? || has_array(tx.get("vShieldedOutput"))?;
        if wanted != actual {
            return Ok(false);
        }
    }
    if let Some(wanted) = filter.has_orchard {
        let actual = has_array(tx.get("orchard").and_then(|value| value.get("actions")))?;
        if wanted != actual {
            return Ok(false);
        }
    }
    if let Some(addresses) = &filter.transparent_output_addresses {
        let outputs = tx
            .get("vout")
            .and_then(Value::as_array)
            .ok_or_else(|| QueryError::new(503, "INVALID_STORED_TRANSACTION"))?;
        let matched = outputs.iter().any(|output| {
            let Some(script) = output.get("scriptPubKey") else {
                return false;
            };
            script
                .get("address")
                .and_then(Value::as_str)
                .is_some_and(|address| addresses.iter().any(|wanted| wanted == address))
                || script
                    .get("addresses")
                    .and_then(Value::as_array)
                    .is_some_and(|values| {
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .any(|address| addresses.iter().any(|wanted| wanted == address))
                    })
        });
        if !matched {
            return Ok(false);
        }
    }
    Ok(true)
}

fn project_block(
    record: BlockRecord,
    request: &QueryRequest,
    control: &QueryControl,
    max_bytes: usize,
) -> Result<(QueryData, usize), QueryError> {
    control.check()?;
    let block = FullBlock::decode(record.payload.as_slice())
        .map_err(|_| QueryError::new(503, "INVALID_STORED_BLOCK"))?;
    if block.height != record.height
        || block.hash != record.hash
        || block.prev_hash != record.prev_hash
        || block.time > u64::from(u32::MAX)
    {
        return Err(QueryError::new(503, "INVALID_STORED_BLOCK"));
    }
    let decoded: Value = serde_json::from_str(&block.decoded_json)
        .map_err(|_| QueryError::new(503, "INVALID_STORED_BLOCK"))?;
    let transactions = decoded
        .get("tx")
        .and_then(Value::as_array)
        .ok_or_else(|| QueryError::new(503, "INVALID_STORED_BLOCK"))?;
    let mut data = QueryData {
        blocks: vec![],
        transactions: vec![],
    };
    let mut budget = ProjectionBudget::new(max_bytes, control)?;
    if !request.field_selection.block.is_empty() {
        budget.object(false)?;
        let mut selected = Map::new();
        for field in &request.field_selection.block {
            let value = match field.as_str() {
                "height" => ProjectedValue::Owned(json!(block.height)),
                "hash" => ProjectedValue::Owned(json!(hex::encode(
                    block.hash.iter().rev().copied().collect::<Vec<_>>()
                ))),
                "previous_hash" => ProjectedValue::Owned(json!(hex::encode(
                    block.prev_hash.iter().rev().copied().collect::<Vec<_>>()
                ))),
                "time" => ProjectedValue::Owned(json!(block.time)),
                "raw" => ProjectedValue::RawBytes(&block.raw_block),
                "decoded" => ProjectedValue::Node(&decoded),
                _ => unreachable!("validated selection"),
            };
            budget.insert(&mut selected, field, value)?;
        }
        data.blocks.push(Value::Object(selected));
    }
    if !request.field_selection.transaction.is_empty() {
        for (index, tx) in transactions.iter().enumerate() {
            control.check()?;
            if !tx.is_object() {
                return Err(QueryError::new(503, "INVALID_STORED_TRANSACTION"));
            }
            if !matches_tx(tx, &request.transaction_filter)? {
                continue;
            }
            budget.object(!data.transactions.is_empty())?;
            let mut selected = Map::new();
            for field in &request.field_selection.transaction {
                let value = match field.as_str() {
                    "txid" => ProjectedValue::HexText(valid_hex_field(tx, "txid", Some(32))?),
                    "block_height" => ProjectedValue::Owned(json!(block.height)),
                    "index" => ProjectedValue::Owned(json!(index)),
                    "version" => ProjectedValue::Owned(json!(node_u32(tx, "version")?)),
                    "locktime" => ProjectedValue::Owned(json!(node_u32(tx, "locktime")?)),
                    "raw" => ProjectedValue::HexText(valid_hex_field(tx, "hex", None)?),
                    "vin" | "vout" | "decoded" => {
                        let value = if field == "decoded" {
                            tx
                        } else {
                            let value = tx.get(field).ok_or_else(|| {
                                QueryError::new(503, "INVALID_STORED_TRANSACTION")
                            })?;
                            if !value.is_array() {
                                return Err(QueryError::new(503, "INVALID_STORED_TRANSACTION"));
                            }
                            value
                        };
                        ProjectedValue::Node(value)
                    }
                    _ => unreachable!("validated selection"),
                };
                budget.insert(&mut selected, field, value)?;
            }
            data.transactions.push(Value::Object(selected));
        }
    }
    Ok((data, budget.bytes))
}

fn project_header(header: BlockHeader, fields: &[String]) -> Result<QueryData, QueryError> {
    if header.hash.len() != 32 || header.prev_hash.len() != 32 || header.time > u64::from(u32::MAX)
    {
        return Err(QueryError::new(503, "INVALID_STORED_BLOCK"));
    }
    let mut data = QueryData {
        blocks: vec![],
        transactions: vec![],
    };
    if fields.is_empty() {
        return Ok(data);
    }
    let mut selected = Map::new();
    for field in fields {
        let value = match field.as_str() {
            "height" => json!(header.height),
            "hash" => json!(hex::encode(
                header.hash.iter().rev().copied().collect::<Vec<_>>()
            )),
            "previous_hash" => json!(hex::encode(
                header.prev_hash.iter().rev().copied().collect::<Vec<_>>()
            )),
            "time" => json!(header.time),
            _ => return Err(QueryError::new(400, "UNSUPPORTED_HEADER_FIELD")),
        };
        selected.insert(field.clone(), value);
    }
    data.blocks.push(Value::Object(selected));
    Ok(data)
}

pub fn execute_query<A: QueryArchive>(
    archive: &A,
    request: &QueryRequest,
    control: &QueryControl,
) -> Result<QueryResponse, QueryError> {
    validate_query(request)?;
    control.check()?;
    if control.max_response_bytes > MAX_RESPONSE_BYTES
        || control.max_response_bytes <= RESPONSE_OVERHEAD
    {
        return Err(QueryError::new(500, "INVALID_RESPONSE_LIMIT"));
    }
    let meta = archive.query_meta();
    if meta.payload_kind != "full-v1" {
        return Err(QueryError::new(409, "FULL_BLOCK_ARCHIVE_REQUIRED"));
    }
    let available_to = meta
        .head
        .map(|height| height + 1)
        .unwrap_or(meta.start_height);
    let parsed_cursor = request.cursor.as_deref().map(decode_cursor).transpose()?;
    if parsed_cursor
        .as_ref()
        .is_some_and(|cursor| cursor.epoch != meta.epoch)
    {
        return Err(QueryError::new(409, "REORG"));
    }
    let to = request.to_block.unwrap_or_else(|| {
        parsed_cursor
            .as_ref()
            .map(|cursor| cursor.to)
            .unwrap_or(available_to)
    });
    if parsed_cursor
        .as_ref()
        .is_some_and(|cursor| cursor.to > available_to)
    {
        return Err(QueryError::new(409, "REORG"));
    }
    if request.from_block < meta.start_height || to > available_to || to < request.from_block {
        return Err(QueryError::new(416, "RANGE_OUTSIDE_INDEXED_ARCHIVE"));
    }
    let fingerprint = fingerprint(request, to)?;
    // Bind to actual canonical prefix content as well as epoch, so rebuilding a
    // directory with a reset epoch cannot silently make an old cursor valid.
    let boundary_hash = if to > request.from_block {
        let header = archive.query_header(to - 1)?;
        if header.hash.len() != 32 {
            return Err(QueryError::new(503, "INVALID_STORED_BLOCK"));
        }
        hex::encode(header.hash.iter().rev().copied().collect::<Vec<_>>())
    } else {
        String::new()
    };
    let mut next = request.from_block;
    if let Some(cursor) = parsed_cursor {
        if cursor.epoch != meta.epoch {
            return Err(QueryError::new(409, "REORG"));
        }
        if cursor.boundary_hash != boundary_hash {
            return Err(QueryError::new(409, "REORG"));
        }
        if cursor.v != 1
            || cursor.network != meta.network
            || cursor.archive_start != meta.start_height
            || cursor.from != request.from_block
            || cursor.to != to
            || cursor.fingerprint != fingerprint
            || cursor.next < request.from_block
            || cursor.next > to
        {
            return Err(QueryError::new(409, "CURSOR_QUERY_MISMATCH"));
        }
        next = cursor.next;
    }
    let page_start = next;
    let stop = to.min(next.saturating_add(u64::from(request.limit)));
    let mut data = QueryData {
        blocks: vec![],
        transactions: vec![],
    };
    let mut encoded_bytes = RESPONSE_OVERHEAD;
    let mut data_content_bytes = 0usize;
    let header_only = request.field_selection.transaction.is_empty()
        && !request
            .field_selection
            .block
            .iter()
            .any(|field| field == "raw" || field == "decoded");
    let mut records = if !header_only && next < stop {
        Some(archive.query_range(next, stop - 1)?)
    } else {
        None
    };
    while next < stop {
        control.check()?;
        let remaining = control.max_response_bytes - encoded_bytes;
        let projection = if header_only {
            let selected =
                project_header(archive.query_header(next)?, &request.field_selection.block)?;
            // At most four fixed header fields (two 64-character hashes and two
            // integers). This tiny buffer is bounded independently of the page;
            // avoid a checked writer and deadline reads for each small field.
            let size = serde_json::to_vec(&selected)
                .map_err(|_| QueryError::new(500, "RESPONSE_ENCODING_FAILED"))?
                .len();
            if size <= remaining {
                Ok((selected, size))
            } else {
                Err(block_too_large())
            }
        } else {
            let record = records
                .as_mut()
                .and_then(|reader| reader.next())
                .ok_or_else(|| QueryError::new(503, "ARCHIVE_READ_FAILED"))??;
            if record.height != next {
                return Err(QueryError::new(503, "INVALID_STORED_BLOCK"));
            }
            project_block(record, request, control, remaining)
        };
        let (mut selected, size) = match projection {
            Ok(projection) => projection,
            Err(error) if error.code == BLOCK_TOO_LARGE && next != page_start => {
                break;
            }
            Err(error) => return Err(error),
        };
        // A QueryData wrapper per block deliberately leaves room for metadata.
        encoded_bytes += size;
        data_content_bytes = data_content_bytes
            .checked_add(appended_data_bytes(&data, &selected, size)?)
            .ok_or_else(|| QueryError::new(500, "RESPONSE_ENCODING_FAILED"))?;
        data.blocks.append(&mut selected.blocks);
        data.transactions.append(&mut selected.transactions);
        next += 1;
    }
    let cursor = if next < to {
        let cursor = Cursor {
            v: 1,
            network: meta.network.clone(),
            archive_start: meta.start_height,
            epoch: meta.epoch,
            from: request.from_block,
            to,
            next,
            fingerprint,
            boundary_hash,
        };
        Some(hex::encode(serde_json::to_vec(&cursor).map_err(|_| {
            QueryError::new(500, "CURSOR_ENCODING_FAILED")
        })?))
    } else {
        None
    };
    let mut response = QueryResponse {
        archive_height: meta.head,
        network: meta.network,
        epoch: meta.epoch.to_string(),
        revision: meta.revision.to_string(),
        from_block: request.from_block,
        to_block: to,
        next_block: next,
        cursor,
        canonicality: "historical_snapshot_not_independently_consensus_validated".into(),
        data: QueryData {
            blocks: vec![],
            transactions: vec![],
        },
    };
    // Only serialize the small metadata wrapper here. The exact data wire size
    // was already counted during projection; do not traverse the large payload
    // again solely to measure it before HTTP serialization.
    let total_bytes = encoded_size(&response, control.max_response_bytes, control)?
        .and_then(|metadata_bytes| metadata_bytes.checked_add(data_content_bytes));
    if total_bytes.is_none_or(|bytes| bytes > control.max_response_bytes) {
        return Err(QueryError::new(
            413,
            "RESPONSE_TOO_LARGE_USE_FIELD_SELECTION",
        ));
    }
    response.data = data;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    struct Fixture {
        meta: QueryMeta,
        blocks: BTreeMap<u64, BlockRecord>,
    }
    impl QueryArchive for Fixture {
        fn query_meta(&self) -> QueryMeta {
            self.meta.clone()
        }
        fn query_block(&self, height: u64) -> Result<BlockRecord, QueryError> {
            self.blocks
                .get(&height)
                .cloned()
                .ok_or_else(|| QueryError::new(503, "ARCHIVE_READ_FAILED"))
        }
    }
    fn fixture(raw_size: usize) -> Fixture {
        let mut blocks = BTreeMap::new();
        for height in 10..=13 {
            let decoded: Value = serde_json::from_str(&format!(r#"{{"tx":[{{"txid":"{}","version":1,"locktime":0,"hex":"010203","vin":[{{"coinbase":"00"}}],"vout":[{{"value":0.123456789123456789,"n":0,"scriptPubKey":{{"addresses":["tExampleAddress"]}}}}]}}]}}"#, "11".repeat(32))).unwrap();
            let full = FullBlock {
                height,
                hash: vec![height as u8; 32],
                prev_hash: vec![height as u8 - 1; 32],
                time: 1700000000,
                raw_block: vec![7; raw_size],
                decoded_json: decoded.to_string(),
            };
            blocks.insert(
                height,
                BlockRecord {
                    height,
                    hash: full.hash.clone(),
                    prev_hash: full.prev_hash.clone(),
                    payload: full.encode_to_vec(),
                },
            );
        }
        Fixture {
            meta: QueryMeta {
                network: "regtest".into(),
                start_height: 10,
                head: Some(12),
                epoch: 3,
                revision: 8,
                payload_kind: "full-v1".into(),
            },
            blocks,
        }
    }
    fn request() -> QueryRequest {
        serde_json::from_value(json!({"from_block":10,"limit":2})).unwrap()
    }

    #[test]
    fn pages_stop_at_captured_head_and_survive_append() {
        let mut archive = fixture(10);
        let mut request = request();
        let first = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert_eq!((first.next_block, first.to_block), (12, 13));
        archive.meta.head = Some(13);
        archive.meta.revision += 1;
        request.cursor = first.cursor;
        let second = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert_eq!((second.next_block, second.to_block), (13, 13));
        assert_eq!(second.data.blocks.len(), 1);
        assert!(second.cursor.is_none());
    }

    #[test]
    fn rollback_and_rebuilt_prefix_invalidate_cursor() {
        let mut archive = fixture(10);
        let mut request = request();
        request.cursor = execute_query(&archive, &request, &QueryControl::default())
            .unwrap()
            .cursor;
        archive.meta.epoch += 1;
        archive.meta.head = Some(10);
        assert_eq!(
            execute_query(&archive, &request, &QueryControl::default())
                .unwrap_err()
                .code,
            "REORG"
        );
        archive.meta.epoch -= 1;
        archive.meta.head = Some(12);
        let record = archive.blocks.get_mut(&12).unwrap();
        let mut rebuilt = FullBlock::decode(record.payload.as_slice()).unwrap();
        rebuilt.hash = vec![99; 32];
        record.hash = rebuilt.hash.clone();
        record.payload = rebuilt.encode_to_vec();
        assert_eq!(
            execute_query(&archive, &request, &QueryControl::default())
                .unwrap_err()
                .code,
            "REORG"
        );
    }

    #[test]
    fn filter_only_empty_pages_still_advance_whole_blocks() {
        let archive = fixture(10);
        let mut request = request();
        request.field_selection.block.clear();
        request.transaction_filter.txids = Some(vec![]);
        let result = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert_eq!(result.next_block, 12);
        assert!(result.data.blocks.is_empty() && result.data.transactions.is_empty());
        request.cursor = result.cursor;
        assert_eq!(
            execute_query(&archive, &request, &QueryControl::default())
                .unwrap()
                .next_block,
            13
        );
    }

    #[test]
    fn cursor_rejects_changed_selection_and_unknown_inputs() {
        let archive = fixture(10);
        let mut request = request();
        request.cursor = execute_query(&archive, &request, &QueryControl::default())
            .unwrap()
            .cursor;
        request.field_selection.block.push("raw".into());
        assert_eq!(
            execute_query(&archive, &request, &QueryControl::default())
                .unwrap_err()
                .code,
            "CURSOR_QUERY_MISMATCH"
        );
        assert!(serde_json::from_value::<QueryRequest>(
            json!({"from_block":10,"transaction_filter":{"shielded_address":"uSecret"}})
        )
        .is_err());
        request.cursor = Some("ff".repeat(MAX_CURSOR_BYTES + 1));
        assert!(validate_query(&request).is_err());
    }

    #[test]
    fn decoded_amounts_are_lossless_strings_and_public_address_filter_works() {
        let archive = fixture(10);
        let mut request = request();
        request.field_selection.transaction = vec!["vout".into(), "decoded".into(), "raw".into()];
        request.transaction_filter.transparent_output_addresses =
            Some(vec!["tExampleAddress".into()]);
        let result = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert_eq!(
            result.data.transactions[0]["vout"][0]["value"],
            "0.123456789123456789"
        );
        assert_eq!(result.data.transactions[0]["vout"][0]["n"], "0");
        assert_eq!(result.data.transactions[0]["decoded"]["version"], "1");
        assert_eq!(result.data.transactions[0]["raw"], "010203");
        request.transaction_filter.transparent_output_addresses =
            Some(vec!["tDifferentAddress".into()]);
        let filtered = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert!(filtered.data.transactions.is_empty());
        assert_eq!(
            filtered.data.blocks.len(),
            2,
            "block projection is independent of tx filters"
        );
    }

    #[test]
    fn response_cap_stops_before_entire_block_or_fails_first_block() {
        let archive = fixture(1500);
        let mut request = request();
        request.limit = 100;
        request.field_selection.block = vec!["height".into(), "raw".into()];
        request.field_selection.transaction.clear();
        let control = QueryControl {
            max_response_bytes: 11000,
            ..Default::default()
        };
        let result = execute_query(&archive, &request, &control).unwrap();
        assert_eq!(result.next_block, 12);
        assert_eq!(result.data.blocks.len(), 2);
        assert!(serde_json::to_vec(&result).unwrap().len() < 11000);
        let small = QueryControl {
            max_response_bytes: 5000,
            ..Default::default()
        };
        assert_eq!(
            execute_query(&archive, &request, &small)
                .unwrap_err()
                .status,
            413
        );
    }

    #[test]
    fn empty_ranges_compact_archives_and_cancel_are_explicit() {
        let mut archive = fixture(10);
        let mut request = request();
        request.to_block = Some(10);
        let result = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert_eq!(result.next_block, 10);
        assert!(result.cursor.is_none() && result.data.blocks.is_empty());
        archive.meta.payload_kind = "compact-v1".into();
        assert_eq!(
            execute_query(&archive, &request, &QueryControl::default())
                .unwrap_err()
                .code,
            "FULL_BLOCK_ARCHIVE_REQUIRED"
        );
        let control = QueryControl::default();
        control.cancelled.store(true, Ordering::Release);
        assert_eq!(
            execute_query(&archive, &request, &control)
                .unwrap_err()
                .status,
            408
        );
    }

    #[test]
    fn header_only_projection_and_cursor_anchor_never_read_full_payloads() {
        struct HeadersOnly(Fixture);
        impl QueryArchive for HeadersOnly {
            fn query_meta(&self) -> QueryMeta {
                self.0.meta.clone()
            }
            fn query_block(&self, _: u64) -> Result<BlockRecord, QueryError> {
                panic!("header query read full payload")
            }
            fn query_header(&self, height: u64) -> Result<BlockHeader, QueryError> {
                let record = self.0.blocks.get(&height).unwrap();
                Ok(BlockHeader {
                    height,
                    hash: record.hash.clone(),
                    prev_hash: record.prev_hash.clone(),
                    time: 1700000000,
                })
            }
        }
        let mut request = request();
        let full = execute_query(&fixture(10), &request, &QueryControl::default()).unwrap();
        request.field_selection.transaction.clear();
        // Block projections are unaffected by transaction filters, including a
        // filter matching nothing. Neither header lookup nor cursor anchoring
        // should decode transaction JSON for this shape.
        request.transaction_filter.txids = Some(vec![]);
        let archive = HeadersOnly(fixture(10));
        let result = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert_eq!(result.data.blocks, full.data.blocks);
        assert_eq!(result.next_block, full.next_block);
        assert!(result.data.transactions.is_empty());
        request.cursor = result.cursor;
        let next = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert_eq!(next.next_block, 13);
        assert!(next.cursor.is_none());
    }

    #[test]
    fn block_decoded_preserves_all_source_fields_and_exact_numbers_without_tx_selection() {
        let mut archive = fixture(10);
        let record = archive.blocks.get_mut(&10).unwrap();
        let mut full = FullBlock::decode(record.payload.as_slice()).unwrap();
        let mut decoded: Value = serde_json::from_str(&full.decoded_json).unwrap();
        decoded["nonce"] = json!("opaque-source-nonce");
        decoded["bits"] = json!("1d00ffff");
        decoded["finalsaplingroot"] = json!("22".repeat(32));
        decoded["future_source_field"] = serde_json::from_str(r#"{"precise":0.123456789123456789,"large":18446744073709551615,"nested":[7,true,"keep"]}"#).unwrap();
        full.decoded_json = decoded.to_string();
        record.payload = full.encode_to_vec();
        let mut request = request();
        request.limit = 1;
        request.field_selection.block = vec!["height".into(), "decoded".into()];
        request.field_selection.transaction.clear();
        let result = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert!(result.data.transactions.is_empty());
        let returned = &result.data.blocks[0]["decoded"];
        assert_eq!(returned, &lossless_node_json(&decoded));
        assert_eq!(returned["nonce"], "opaque-source-nonce");
        assert_eq!(
            returned["future_source_field"]["precise"],
            "0.123456789123456789"
        );
        assert_eq!(
            returned["future_source_field"]["large"],
            "18446744073709551615"
        );
        assert_eq!(returned["future_source_field"]["nested"][0], "7");
        assert_eq!(
            returned["tx"][0]["vout"][0]["value"],
            "0.123456789123456789"
        );
    }

    #[test]
    fn counting_writer_matches_wire_bytes_and_checks_limits_and_cancellation() {
        let value: Value = serde_json::from_str(
            r#"{"escaped":"\"\\\n\t\u0000","unicode":"Zcash 雪","nested":[0.123456789123456789,18446744073709551615,true,null]}"#,
        )
        .unwrap();
        let control = QueryControl::default();
        let expected = serde_json::to_vec(&lossless_node_json(&value)).unwrap();
        assert_eq!(serde_json::to_vec(&LosslessNode(&value)).unwrap(), expected);
        assert_eq!(
            encoded_size(&LosslessNode(&value), expected.len(), &control).unwrap(),
            Some(expected.len())
        );
        assert_eq!(
            encoded_size(&LosslessNode(&value), expected.len() - 1, &control).unwrap(),
            None
        );
        assert_eq!(encoded_size(&value, 0, &control).unwrap(), None);
        control.cancelled.store(true, Ordering::Release);
        assert_eq!(encoded_size(&value, 0, &control).unwrap_err().status, 408);
    }

    #[test]
    fn incremental_projection_budget_matches_every_field_and_exact_block_boundary() {
        let mut archive = fixture(1500);
        let record = archive.blocks.get_mut(&10).unwrap();
        let mut full = FullBlock::decode(record.payload.as_slice()).unwrap();
        let mut decoded: Value = serde_json::from_str(&full.decoded_json).unwrap();
        let mut tx = decoded["tx"][0].clone();
        tx["hex"] = json!("ABCDEF");
        tx["extra"] = json!({"escaped":"\"\\\n\t\0", "unicode":"雪"});
        decoded["tx"].as_array_mut().unwrap().push(tx);
        full.decoded_json = decoded.to_string();
        record.payload = full.encode_to_vec();
        let control = QueryControl::default();
        let mut request = request();
        request.field_selection.block = BLOCK_FIELDS.iter().map(|field| (*field).into()).collect();
        request.field_selection.transaction =
            TX_FIELDS.iter().map(|field| (*field).into()).collect();
        let (projected, counted) =
            project_block(record.clone(), &request, &control, MAX_RESPONSE_BYTES).unwrap();
        let encoded = serde_json::to_vec(&projected).unwrap();
        assert_eq!(counted, encoded.len());
        assert_eq!(projected.transactions[1]["raw"], "abcdef");
        assert_eq!(
            projected.transactions[1]["decoded"]["vout"][0]["value"],
            "0.123456789123456789"
        );
        assert_eq!(
            project_block(record.clone(), &request, &control, counted).unwrap(),
            (projected, counted)
        );
        assert_eq!(
            project_block(record.clone(), &request, &control, counted - 1)
                .unwrap_err()
                .code,
            BLOCK_TOO_LARGE
        );
    }

    #[test]
    fn budget_pagination_retains_identical_whole_blocks_and_transactions() {
        let archive = fixture(800);
        let mut request = request();
        request.limit = 100;
        request.field_selection.block = vec!["height".into(), "raw".into(), "decoded".into()];
        request.field_selection.transaction = vec!["decoded".into(), "vout".into()];
        let control = QueryControl::default();
        let expected = execute_query(&archive, &request, &control).unwrap();
        let (_, first_block_size) = project_block(
            archive.query_block(10).unwrap(),
            &request,
            &control,
            MAX_RESPONSE_BYTES,
        )
        .unwrap();
        let bounded = QueryControl {
            max_response_bytes: RESPONSE_OVERHEAD + first_block_size,
            ..Default::default()
        };
        let mut actual = QueryData {
            blocks: vec![],
            transactions: vec![],
        };
        for height in 10..13 {
            let page = execute_query(&archive, &request, &bounded).unwrap();
            assert_eq!(page.next_block, height + 1);
            assert_eq!(page.data.blocks.len(), 1);
            assert!(serde_json::to_vec(&page).unwrap().len() <= bounded.max_response_bytes);
            actual.blocks.extend(page.data.blocks);
            actual.transactions.extend(page.data.transactions);
            request.cursor = page.cursor;
        }
        assert!(request.cursor.is_none());
        assert_eq!(actual, expected.data);
    }

    #[test]
    fn oversized_decoded_field_is_rejected_before_materializing_its_projection() {
        let value = json!({"huge": "a".repeat(1024 * 1024)});
        let control = QueryControl::default();
        let mut budget = ProjectionBudget::new(256, &control).unwrap();
        budget.object(false).unwrap();
        let mut selected = Map::new();
        assert_eq!(
            budget
                .insert(&mut selected, "decoded", ProjectedValue::Node(&value))
                .unwrap_err()
                .code,
            BLOCK_TOO_LARGE
        );
        assert!(selected.is_empty());

        let mut budget = ProjectionBudget::new(256, &control).unwrap();
        budget.object(false).unwrap();
        assert_eq!(
            budget
                .insert(&mut selected, "raw", ProjectedValue::RawBytes(&[0; 1024]))
                .unwrap_err()
                .code,
            BLOCK_TOO_LARGE
        );
        assert!(selected.is_empty());
    }

    #[test]
    fn full_query_uses_one_lazy_range_per_page_and_checks_record_order() {
        use std::cell::Cell;
        struct RangeOnly {
            fixture: Fixture,
            ranges: Cell<usize>,
            reads: Cell<usize>,
            wrong_height: bool,
        }
        impl QueryArchive for RangeOnly {
            fn query_meta(&self) -> QueryMeta {
                self.fixture.query_meta()
            }
            fn query_block(&self, _: u64) -> Result<BlockRecord, QueryError> {
                panic!("full query opened a per-block reader")
            }
            fn query_header(&self, height: u64) -> Result<BlockHeader, QueryError> {
                self.fixture.query_header(height)
            }
            fn query_range(
                &self,
                start: u64,
                end: u64,
            ) -> Result<Box<dyn Iterator<Item = Result<BlockRecord, QueryError>> + '_>, QueryError>
            {
                self.ranges.set(self.ranges.get() + 1);
                Ok(Box::new((start..=end).map(|height| {
                    self.reads.set(self.reads.get() + 1);
                    let mut record = self.fixture.query_block(height)?;
                    if self.wrong_height {
                        record.height += 1;
                    }
                    Ok(record)
                })))
            }
        }
        let mut archive = RangeOnly {
            fixture: fixture(10),
            ranges: Cell::new(0),
            reads: Cell::new(0),
            wrong_height: false,
        };
        let mut request = request();
        let first = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert_eq!((archive.ranges.get(), archive.reads.get()), (1, 2));
        request.cursor = first.cursor;
        let second = execute_query(&archive, &request, &QueryControl::default()).unwrap();
        assert_eq!((archive.ranges.get(), archive.reads.get()), (2, 3));
        assert!(second.cursor.is_none());
        request.cursor = None;
        archive.wrong_height = true;
        assert_eq!(
            execute_query(&archive, &request, &QueryControl::default())
                .unwrap_err()
                .code,
            "INVALID_STORED_BLOCK"
        );
    }

    #[test]
    fn aggregate_data_size_matches_json_across_empty_and_nonempty_groups() {
        let precise: Value = serde_json::from_str(
            r#"{"amount":0.123456789123456789,"large":18446744073709551615,"escaped":"\n\"\\","unicode":"雪"}"#,
        )
        .unwrap();
        let precise = lossless_node_json(&precise);
        let groups = [
            QueryData {
                blocks: vec![],
                transactions: vec![],
            },
            QueryData {
                blocks: vec![json!({"height":0}), json!({"height":10})],
                transactions: vec![],
            },
            QueryData {
                blocks: vec![],
                transactions: vec![],
            },
            QueryData {
                blocks: vec![],
                transactions: vec![precise.clone(), json!({"index":9})],
            },
            QueryData {
                blocks: vec![json!({"height":u32::MAX})],
                transactions: vec![precise.clone()],
            },
            QueryData {
                blocks: vec![],
                transactions: vec![json!({"index":10})],
            },
            QueryData {
                blocks: vec![json!({"height":11})],
                transactions: vec![],
            },
            QueryData {
                blocks: vec![],
                transactions: vec![],
            },
        ];
        let mut merged = QueryData {
            blocks: vec![],
            transactions: vec![],
        };
        let mut content_bytes = 0;
        assert_eq!(serde_json::to_vec(&merged).unwrap().len(), EMPTY_DATA_BYTES);
        for selected in groups {
            let selected_bytes = serde_json::to_vec(&selected).unwrap().len();
            content_bytes += appended_data_bytes(&merged, &selected, selected_bytes).unwrap();
            merged.blocks.extend(selected.blocks);
            merged.transactions.extend(selected.transactions);
            assert_eq!(
                serde_json::to_vec(&merged).unwrap().len(),
                EMPTY_DATA_BYTES + content_bytes
            );
        }
        assert_eq!(
            appended_data_bytes(&merged, &merged, EMPTY_DATA_BYTES - 1)
                .unwrap_err()
                .code,
            "RESPONSE_ENCODING_FAILED"
        );
    }

    #[test]
    fn final_metadata_plus_data_size_enforces_exact_response_byte_limit() {
        // A deliberately long fixture network makes metadata exceed the normal
        // conservative reservation, so the independent final guard is exercised.
        let mut archive = fixture(10);
        archive.meta.network = "regtest\n\"\\".repeat(600);
        for (limit, to_block) in [(1, None), (100, None), (1, Some(10))] {
            let mut request = request();
            request.limit = limit;
            request.to_block = to_block;
            request.field_selection.block = vec!["height".into(), "decoded".into()];
            request.field_selection.transaction = vec!["decoded".into(), "vout".into()];
            let expected = execute_query(&archive, &request, &QueryControl::default()).unwrap();
            let wire = serde_json::to_vec(&expected).unwrap();
            assert!(wire.len() > RESPONSE_OVERHEAD);
            let exact = QueryControl {
                max_response_bytes: wire.len(),
                ..Default::default()
            };
            let actual = execute_query(&archive, &request, &exact).unwrap();
            assert_eq!(serde_json::to_vec(&actual).unwrap(), wire);
            let one_short = QueryControl {
                max_response_bytes: wire.len() - 1,
                ..Default::default()
            };
            let error = execute_query(&archive, &request, &one_short).unwrap_err();
            assert_eq!(
                (error.status, error.code),
                (413, "RESPONSE_TOO_LARGE_USE_FIELD_SELECTION")
            );
        }
    }
}
