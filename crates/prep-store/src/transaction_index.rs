//! Optional derived cache; malformed/over-budget metadata falls back to payload reads.
use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::fmt;
use std::mem::size_of;

pub(crate) const SEGMENT_INDEX_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const ARCHIVE_INDEX_BYTES: usize = 64 * 1024 * 1024;

/// Native public projection. Txid bytes use conventional RPC/display order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionMetadata {
    pub txid: [u8; 32],
    pub block_height: u64,
    pub index: u32,
    pub version: u32,
    pub locktime: u32,
    pub size_bytes: u32,
    pub transparent_input_count: u32,
    pub transparent_output_count: u32,
    pub has_sapling: bool,
    pub has_orchard: bool,
}

pub(crate) struct TransactionIndex {
    rows: Vec<TransactionMetadata>,
    by_txid: Vec<u32>,
    block_starts: Vec<usize>,
    start_height: u64,
}

impl TransactionIndex {
    pub(crate) fn bytes(&self) -> usize {
        size_of::<Self>()
            + 2 * size_of::<usize>()
            + self.rows.capacity() * size_of::<TransactionMetadata>()
            + self.by_txid.capacity() * size_of::<u32>()
            + self.block_starts.capacity() * size_of::<usize>()
    }
    pub(crate) fn block(&self, height: u64) -> Vec<TransactionMetadata> {
        let index = (height - self.start_height) as usize;
        self.rows[self.block_starts[index]..self.block_starts[index + 1]].to_vec()
    }
    pub(crate) fn locations(&self, ids: &[[u8; 32]], start: u64, end: u64) -> Vec<u64> {
        let mut matched = vec![false; (end - start + 1) as usize];
        for id in ids {
            let first = self
                .by_txid
                .partition_point(|index| self.rows[*index as usize].txid < *id);
            let last = self
                .by_txid
                .partition_point(|index| self.rows[*index as usize].txid <= *id);
            for index in &self.by_txid[first..last] {
                let height = self.rows[*index as usize].block_height;
                if (start..=end).contains(&height) {
                    matched[(height - start) as usize] = true;
                }
            }
        }
        matched
            .into_iter()
            .enumerate()
            .filter_map(|(offset, found)| found.then_some(start + offset as u64))
            .collect()
    }
}

/// Reserve both row and secondary-index capacity before allocating rows.
pub(crate) struct IndexBuilder {
    rows: Vec<TransactionMetadata>,
    block_starts: Vec<usize>,
    start_height: u64,
    max_rows: usize,
    budget: usize,
    expected_blocks: usize,
}
impl IndexBuilder {
    pub(crate) fn new(start_height: u64, blocks: usize, budget: usize) -> Option<Self> {
        let budget = budget.min(SEGMENT_INDEX_BYTES);
        let offsets = blocks.checked_add(1)?;
        let base = size_of::<TransactionIndex>()
            .checked_add(2 * size_of::<usize>())?
            .checked_add(offsets.checked_mul(size_of::<usize>())?)?;
        if base > budget {
            return None;
        }
        let mut block_starts = Vec::new();
        block_starts.try_reserve_exact(offsets).ok()?;
        let base = size_of::<TransactionIndex>()
            .checked_add(2 * size_of::<usize>())?
            .checked_add(block_starts.capacity().checked_mul(size_of::<usize>())?)?;
        if base > budget {
            return None;
        }
        block_starts.push(0);
        Some(Self {
            rows: Vec::new(),
            block_starts,
            start_height,
            max_rows: (budget - base) / (size_of::<TransactionMetadata>() + size_of::<u32>()),
            budget,
            expected_blocks: blocks,
        })
    }
    fn push(&mut self, row: TransactionMetadata) -> Option<()> {
        if self.rows.len() >= self.max_rows || self.rows.len() >= u32::MAX as usize {
            return None;
        }
        if self.rows.len() == self.rows.capacity() {
            let capacity = self.rows.len().checked_add(256)?.min(self.max_rows);
            self.rows
                .try_reserve_exact(capacity - self.rows.len())
                .ok()?;
        }
        self.rows.push(row);
        Some(())
    }
    pub(crate) fn block(&mut self, height: u64, json: &str) -> Option<()> {
        if height != self.start_height + self.block_starts.len() as u64 - 1 {
            return None;
        }
        let mut deserializer = serde_json::Deserializer::from_str(json);
        BlockSeed {
            sink: &mut |row| self.push(row),
            height,
        }
        .deserialize(&mut deserializer)
        .ok()?;
        deserializer.end().ok()?;
        self.block_starts.push(self.rows.len());
        Some(())
    }
    pub(crate) fn finish(self) -> Option<TransactionIndex> {
        if self.block_starts.len() != self.expected_blocks + 1 {
            return None;
        }
        let mut by_txid = Vec::new();
        by_txid.try_reserve_exact(self.rows.len()).ok()?;
        by_txid.extend((0..self.rows.len()).map(|index| index as u32));
        by_txid.sort_unstable_by_key(|index| {
            let row = &self.rows[*index as usize];
            (row.txid, row.block_height, row.index)
        });
        let index = TransactionIndex {
            rows: self.rows,
            by_txid,
            block_starts: self.block_starts,
            start_height: self.start_height,
        };
        (index.bytes() <= self.budget).then_some(index)
    }
}

/// Stream the same strict projection used by the bounded RAM cache.
pub(crate) fn stream_metadata(
    height: u64,
    json: &str,
    sink: &mut dyn FnMut(TransactionMetadata) -> Option<()>,
) -> Option<()> {
    let mut deserializer = serde_json::Deserializer::from_str(json);
    BlockSeed { sink, height }
        .deserialize(&mut deserializer)
        .ok()?;
    deserializer.end().ok()
}

#[derive(Default)]
struct ArrayCount(u32);
impl<'de> Deserialize<'de> for ArrayCount {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct Count;
        impl<'de> Visitor<'de> for Count {
            type Value = ArrayCount;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("an array")
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> std::result::Result<ArrayCount, A::Error> {
                let mut count = 0u32;
                while sequence.next_element::<IgnoredAny>()?.is_some() {
                    count = count
                        .checked_add(1)
                        .ok_or_else(|| serde::de::Error::custom("array count overflow"))?;
                }
                Ok(ArrayCount(count))
            }
        }
        deserializer.deserialize_seq(Count)
    }
}
#[derive(Default)]
struct Size(Option<u32>);
impl<'de> Deserialize<'de> for Size {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Ok(Size(Some(u32::deserialize(deserializer)?)))
    }
}
#[derive(Deserialize)]
struct Orchard {
    #[serde(default)]
    actions: Option<ArrayCount>,
}
#[derive(Deserialize)]
struct MetadataInput<'a> {
    #[serde(borrow)]
    txid: &'a str,
    #[serde(borrow)]
    hex: &'a str,
    version: u32,
    locktime: u32,
    #[serde(default)]
    size: Size,
    vin: ArrayCount,
    vout: ArrayCount,
    #[serde(default, rename = "vShieldedSpend")]
    sapling_spends: Option<ArrayCount>,
    #[serde(default, rename = "vShieldedOutput")]
    sapling_outputs: Option<ArrayCount>,
    #[serde(default)]
    orchard: Option<Orchard>,
}
impl MetadataInput<'_> {
    fn metadata(self, block_height: u64, index: u32) -> Option<TransactionMetadata> {
        if self.txid.len() != 64
            || !self.txid.bytes().all(|byte| byte.is_ascii_hexdigit())
            || self.hex.is_empty()
            || !self.hex.len().is_multiple_of(2)
            || !self.hex.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return None;
        }
        let mut txid = [0; 32];
        hex::decode_to_slice(self.txid, &mut txid).ok()?;
        let size_bytes = u32::try_from(self.hex.len() / 2).ok()?;
        if self.size.0.is_some_and(|size| size != size_bytes) {
            return None;
        }
        Some(TransactionMetadata {
            txid,
            block_height,
            index,
            version: self.version,
            locktime: self.locktime,
            size_bytes,
            transparent_input_count: self.vin.0,
            transparent_output_count: self.vout.0,
            has_sapling: self.sapling_spends.is_some_and(|count| count.0 > 0)
                || self.sapling_outputs.is_some_and(|count| count.0 > 0),
            has_orchard: self
                .orchard
                .and_then(|orchard| orchard.actions)
                .is_some_and(|count| count.0 > 0),
        })
    }
}

struct BlockSeed<'a> {
    sink: &'a mut dyn FnMut(TransactionMetadata) -> Option<()>,
    height: u64,
}
impl<'de> DeserializeSeed<'de> for BlockSeed<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> std::result::Result<(), D::Error> {
        struct BlockVisitor<'a> {
            sink: &'a mut dyn FnMut(TransactionMetadata) -> Option<()>,
            height: u64,
        }
        impl<'de> Visitor<'de> for BlockVisitor<'_> {
            type Value = ();
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a decoded full block object")
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut object: A,
            ) -> std::result::Result<(), A::Error> {
                let mut found = false;
                while let Some(key) = object.next_key::<String>()? {
                    if key == "tx" {
                        if found {
                            return Err(serde::de::Error::custom("duplicate tx field"));
                        }
                        found = true;
                        object.next_value_seed(TransactionsSeed {
                            sink: self.sink,
                            height: self.height,
                        })?;
                    } else {
                        object.next_value::<IgnoredAny>()?;
                    }
                }
                if !found {
                    return Err(serde::de::Error::custom("missing tx field"));
                }
                Ok(())
            }
        }
        deserializer.deserialize_map(BlockVisitor {
            sink: self.sink,
            height: self.height,
        })
    }
}
struct TransactionsSeed<'a> {
    sink: &'a mut dyn FnMut(TransactionMetadata) -> Option<()>,
    height: u64,
}
impl<'de> DeserializeSeed<'de> for TransactionsSeed<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> std::result::Result<(), D::Error> {
        struct TransactionsVisitor<'a> {
            sink: &'a mut dyn FnMut(TransactionMetadata) -> Option<()>,
            height: u64,
        }
        impl<'de> Visitor<'de> for TransactionsVisitor<'_> {
            type Value = ();
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a full transaction array")
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> std::result::Result<(), A::Error> {
                let mut index = 0u32;
                while let Some(transaction) = sequence.next_element::<MetadataInput<'de>>()? {
                    let row = transaction
                        .metadata(self.height, index)
                        .ok_or_else(|| serde::de::Error::custom("unsupported metadata"))?;
                    (self.sink)(row).ok_or_else(|| {
                        serde::de::Error::custom("metadata index budget exceeded")
                    })?;
                    index = index
                        .checked_add(1)
                        .ok_or_else(|| serde::de::Error::custom("transaction index overflow"))?;
                }
                if index == 0 {
                    return Err(serde::de::Error::custom(
                        "empty transaction array uses legacy fallback",
                    ));
                }
                Ok(())
            }
        }
        deserializer.deserialize_seq(TransactionsVisitor {
            sink: self.sink,
            height: self.height,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn json(id: &str) -> String {
        format!(
            r#"{{"tx":[{{"txid":"{id}","hex":"000102","version":2,"locktime":4294967295,"size":3,"vin":[{{}}],"vout":[{{"value":9007199254740993}},{{"value":0.00000001}}],"vShieldedSpend":[],"vShieldedOutput":[{{}}],"orchard":{{"actions":[{{}}]}}}}]}}"#
        )
    }
    #[test]
    fn streaming_metadata_keeps_duplicate_locations_and_exact_public_fields() {
        let id = "ab".repeat(32);
        let mut builder = IndexBuilder::new(1, 2, SEGMENT_INDEX_BYTES).unwrap();
        builder.block(1, &json(&id)).unwrap();
        builder.block(2, &json(&id.to_uppercase())).unwrap();
        let index = builder.finish().unwrap();
        let row = &index.block(1)[0];
        assert_eq!(row.txid, [0xab; 32]);
        assert_eq!(row.index, 0);
        assert_eq!(row.locktime, u32::MAX);
        assert_eq!(row.size_bytes, 3);
        assert_eq!(row.transparent_input_count, 1);
        assert_eq!(row.transparent_output_count, 2);
        assert!(row.has_sapling && row.has_orchard);
        assert_eq!(index.locations(&[[0xab; 32], [0xab; 32]], 1, 2), [1, 2]);
        assert_eq!(index.locations(&[[0xab; 32]], 2, 2), [2]);
        assert!(index.locations(&[[0; 32]], 1, 2).is_empty());
        assert!(index.bytes() <= SEGMENT_INDEX_BYTES);
    }
    #[test]
    fn unsupported_metadata_never_publishes_a_partial_negative_index() {
        let original = json(&"ab".repeat(32));
        for malformed in [
            original.replace("\"size\":3", "\"size\":4"),
            original.replace("\"size\":3", "\"size\":null"),
            original.replace("\"version\":2", "\"version\":2.5"),
            original.replace("\"locktime\":4294967295", "\"locktime\":4294967296"),
            original.replace("\"vin\":[{}]", "\"vin\":{}"),
            original.replace("\"vShieldedSpend\":[]", "\"vShieldedSpend\":true"),
            "{\"tx\":[]}".into(),
        ] {
            let mut builder = IndexBuilder::new(1, 2, SEGMENT_INDEX_BYTES).unwrap();
            builder.block(1, &original).unwrap();
            assert!(builder.block(2, &malformed).is_none());
            assert!(builder.finish().is_none());
        }
    }
    #[test]
    fn budgets_include_reserved_rows_offsets_and_secondary_capacity() {
        assert!(IndexBuilder::new(1, 1000, 8).is_none());
        let mut builder = IndexBuilder::new(1, 1, 1024).unwrap();
        builder.block(1, &json(&"ab".repeat(32))).unwrap();
        assert!(builder.finish().unwrap().bytes() <= 1024);
        let input = format!(
            "{{\"tx\":[{}]}}",
            std::iter::repeat_n(
                json(&"ab".repeat(32))
                    .strip_prefix("{\"tx\":[")
                    .unwrap()
                    .strip_suffix("]}")
                    .unwrap()
                    .to_owned(),
                100
            )
            .collect::<Vec<_>>()
            .join(",")
        );
        let mut builder = IndexBuilder::new(1, 1, 1024).unwrap();
        assert!(builder.block(1, &input).is_none());
        assert!(builder.finish().is_none());
    }

    #[test]
    fn exact_minimum_budget_boundary_is_all_or_nothing() {
        let rows = 3;
        let base = size_of::<TransactionIndex>() + 4 * size_of::<usize>();
        let minimum = base + rows * (size_of::<TransactionMetadata>() + size_of::<u32>());
        let tx = json(&"ab".repeat(32));
        let tx = tx
            .strip_prefix("{\"tx\":[")
            .unwrap()
            .strip_suffix("]}")
            .unwrap();
        let input = format!("{{\"tx\":[{}]}}", [tx; 3].join(","));
        let mut exact = IndexBuilder::new(1, 1, minimum).unwrap();
        exact.block(1, &input).unwrap();
        assert_eq!(exact.finish().unwrap().bytes(), minimum);
        let mut below = IndexBuilder::new(1, 1, minimum - 1).unwrap();
        assert!(below.block(1, &input).is_none());
        assert!(below.finish().is_none());
    }
}
