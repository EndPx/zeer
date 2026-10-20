//! Stateless, watch-only full-transaction receipt scanning. No network or signing API.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fmt, io::Cursor};
use zcash_client_backend::{decrypt_transaction, TransferType};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_primitives::transaction::{Transaction, TxVersion};
use zcash_protocol::{
    consensus::{BlockHeight, BranchId, TEST_NETWORK},
    value::Zatoshis,
};
use zeroize::Zeroizing;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_TRANSACTION_BYTES: usize = 2_000_000;
pub const MAX_FRAME_BYTES: usize = 4_100_000;
pub const MAX_RECEIPTS: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanError(pub &'static str);
impl fmt::Display for ScanError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for ScanError {}
type Result<T> = std::result::Result<T, ScanError>;
fn require(ok: bool, code: &'static str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(ScanError(code))
    }
}
fn hex_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScanRequest {
    pub protocol_version: u32,
    pub request_id: u32,
    pub network: String,
    pub height: u32,
    pub txid: String,
    pub raw: String,
}

/// This is a readable note observation, not proof of a payment from another party.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub id: String,
    pub account_id: String,
    pub network: String,
    pub txid: String,
    pub pool: String,
    pub output_index: u32,
    pub height: u32,
    /// A pool receiver component, not an entire multi-receiver Unified Address.
    pub receiver: String,
    pub receiver_type: String,
    pub value_zat: String,
    /// All 512 bytes, including padding; binary and empty memos are preserved.
    pub memo_hex: String,
    pub scope: String,
    pub origin: String,
    pub is_coinbase: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScanResult {
    pub protocol_version: u32,
    pub request_id: u32,
    pub network: String,
    pub account_id: String,
    pub key_fingerprint: String,
    pub txid: String,
    pub height: u32,
    pub complete: bool,
    pub receipts: Vec<Receipt>,
}

/// One configured watch-only account. Deliberately has no Debug implementation.
pub struct Scanner {
    account: String,
    fingerprint: String,
    keys: HashMap<u32, UnifiedFullViewingKey>,
}
impl Scanner {
    pub fn new(account: &str, encoding: &str) -> Result<Self> {
        require(
            !account.is_empty()
                && account.len() <= 64
                && account
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'),
            "INVALID_ACCOUNT_ID",
        )?;
        require(encoding.len() <= 4096, "INVALID_VIEWING_KEY")?;
        let key = UnifiedFullViewingKey::decode(&TEST_NETWORK, encoding)
            .map_err(|_| ScanError("INVALID_TESTNET_UFVK"))?;
        // This first profile always scans all three pools; partial keys are not silently accepted.
        require(
            key.sapling().is_some() && key.orchard().is_some(),
            "UFVK_REQUIRES_SAPLING_AND_ORCHARD",
        )?;
        let canonical = Zeroizing::new(
            key.encode(&TEST_NETWORK)
                .map_err(|_| ScanError("INVALID_TESTNET_UFVK"))?,
        );
        let fingerprint = hex::encode(Sha256::digest(canonical.as_bytes()));
        Ok(Self {
            account: account.into(),
            fingerprint,
            keys: HashMap::from([(0, key)]),
        })
    }
    pub fn account(&self) -> &str {
        &self.account
    }
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }
    /// Operator-local identity inspection; never exposed by Prep's public API.
    pub fn profile(&self) -> serde_json::Value {
        let key = &self.keys[&0];
        serde_json::json!({"account_id":self.account,"network":"testnet","key_fingerprint":self.fingerprint,
            "sapling_receiver":hex::encode(key.sapling().expect("checked on import").default_address().1.to_bytes()),
            "orchard_receiver":hex::encode(key.orchard().expect("checked on import").address_at(0u32,zip32::Scope::External).to_raw_address_bytes())})
    }
    pub fn capabilities(&self) -> serde_json::Value {
        serde_json::json!({"protocol_version":PROTOCOL_VERSION,"network":"testnet","account_id":self.account,"key_fingerprint":self.fingerprint,
            "pools":["sapling","orchard","ironwood"],"scope":"readable_positive_incoming_notes_not_consensus_or_confirmations",
            "max_transaction_bytes":MAX_TRANSACTION_BYTES,"max_frame_bytes":MAX_FRAME_BYTES,"max_receipts":MAX_RECEIPTS,"stateless":true})
    }
    pub fn scan(&self, request: &ScanRequest) -> Result<ScanResult> {
        require(
            request.protocol_version == PROTOCOL_VERSION && request.network == "testnet",
            "SCANNER_PROTOCOL_OR_NETWORK_MISMATCH",
        )?;
        require(hex_id(&request.txid), "INVALID_TRANSACTION_ID")?;
        require(
            !request.raw.is_empty()
                && request.raw.len() <= MAX_TRANSACTION_BYTES * 2
                && request.raw.len().is_multiple_of(2),
            "INVALID_TRANSACTION_SIZE",
        )?;
        let bytes = hex::decode(&request.raw).map_err(|_| ScanError("INVALID_TRANSACTION_HEX"))?;
        let branch = BranchId::for_height(&TEST_NETWORK, BlockHeight::from_u32(request.height));
        let mut reader = Cursor::new(&bytes);
        let tx = Transaction::read(&mut reader, branch)
            .map_err(|_| ScanError("INVALID_OR_UNSUPPORTED_TRANSACTION"))?;
        require(
            reader.position() as usize == bytes.len(),
            "TRAILING_TRANSACTION_BYTES",
        )?;
        require(
            tx.txid().to_string() == request.txid,
            "TRANSACTION_ID_MISMATCH",
        )?;
        require(
            tx.consensus_branch_id() == branch,
            "TRANSACTION_BRANCH_HEIGHT_MISMATCH",
        )?;
        require(
            matches!(tx.version(), TxVersion::V4 | TxVersion::V5 | TxVersion::V6)
                && tx.sprout_bundle().is_none(),
            "UNSUPPORTED_TRANSACTION_OR_SPROUT",
        )?;
        let decoded = decrypt_transaction(
            &TEST_NETWORK,
            Some(BlockHeight::from_u32(request.height)),
            None,
            &tx,
            &self.keys,
        );
        let is_coinbase = tx
            .transparent_bundle()
            .is_some_and(|bundle| bundle.is_coinbase());
        let mut receipts = Vec::new();
        for output in decoded.sapling_outputs() {
            if let Some(scope) = receipt_scope(output.transfer_type()) {
                self.add(
                    &mut receipts,
                    request,
                    "sapling",
                    output.index(),
                    output.note().recipient().to_bytes(),
                    output.note().value().inner(),
                    output.memo().as_array(),
                    scope,
                    is_coinbase,
                )?;
            }
        }
        for (pool, outputs) in [
            ("orchard", decoded.orchard_outputs()),
            ("ironwood", decoded.ironwood_outputs()),
        ] {
            for output in outputs {
                if let Some(scope) = receipt_scope(output.transfer_type()) {
                    let note = &output.note().0;
                    self.add(
                        &mut receipts,
                        request,
                        pool,
                        output.index(),
                        note.recipient().to_raw_address_bytes(),
                        note.value().inner(),
                        output.memo().as_array(),
                        scope,
                        is_coinbase,
                    )?;
                }
            }
        }
        Ok(ScanResult {
            protocol_version: PROTOCOL_VERSION,
            request_id: request.request_id,
            network: "testnet".into(),
            account_id: self.account.clone(),
            key_fingerprint: self.fingerprint.clone(),
            txid: request.txid.clone(),
            height: request.height,
            complete: true,
            receipts,
        })
    }
    #[allow(clippy::too_many_arguments)]
    fn add(
        &self,
        out: &mut Vec<Receipt>,
        request: &ScanRequest,
        pool: &str,
        index: usize,
        receiver: [u8; 43],
        value: u64,
        memo: &[u8; 512],
        scope: &str,
        is_coinbase: bool,
    ) -> Result<()> {
        Zatoshis::from_u64(value).map_err(|_| ScanError("INVALID_NOTE_VALUE"))?;
        if value == 0 {
            return Ok(());
        }
        require(out.len() < MAX_RECEIPTS, "TOO_MANY_RECEIPTS")?;
        let index = u32::try_from(index).map_err(|_| ScanError("OUTPUT_INDEX_OVERFLOW"))?;
        let mut digest = Sha256::new();
        for part in [
            "zeer.receipt.v1",
            "testnet",
            &self.account,
            &self.fingerprint,
            &request.txid,
            pool,
        ] {
            digest.update(part.as_bytes());
            digest.update([0]);
        }
        digest.update(index.to_le_bytes());
        out.push(Receipt {
            id: hex::encode(digest.finalize()),
            account_id: self.account.clone(),
            network: "testnet".into(),
            txid: request.txid.clone(),
            pool: pool.into(),
            output_index: index,
            height: request.height,
            receiver: hex::encode(receiver),
            receiver_type: if pool == "sapling" {
                "sapling"
            } else {
                "orchard"
            }
            .into(),
            value_zat: value.to_string(),
            memo_hex: hex::encode(memo),
            scope: scope.into(),
            origin: "unknown".into(),
            is_coinbase,
        });
        Ok(())
    }
}
fn receipt_scope(kind: TransferType) -> Option<&'static str> {
    match kind {
        TransferType::Incoming => Some("external"),
        TransferType::AccountInternal => Some("internal"),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
