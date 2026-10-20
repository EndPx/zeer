//! Offline cryptographic fixtures only. Proofs/signatures are placeholders, never broadcast.
use super::*;
use nonempty::NonEmpty;
use orchard::{
    bundle::{Authorized, BundleVersion},
    note::{
        ExtractedNoteCommitment, NoteVersion, Nullifier, RandomSeed, Rho, TransmittedNoteCiphertext,
    },
    note_encryption::{
        IronwoodDomain, IronwoodNoteEncryption, OrchardDomain, OrchardNoteEncryption,
    },
    primitives::redpallas,
    value::{NoteValue, ValueCommitTrapdoor, ValueCommitment},
    Action, Anchor, Bundle, Note, Proof,
};
use rand_chacha::{rand_core::SeedableRng, ChaCha20Rng};
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_note_encryption::Domain;
use zcash_primitives::transaction::TransactionData;
use zcash_protocol::value::ZatBalance;
use zip32::{AccountId, Scope};

fn key(seed: u8) -> UnifiedFullViewingKey {
    // Public, unfunded fixture material. Production accepts only UFVKs.
    UnifiedSpendingKey::from_seed(&TEST_NETWORK, &[seed; 32], AccountId::ZERO)
        .unwrap()
        .to_unified_full_viewing_key()
}
fn sapling_output(
    key: &UnifiedFullViewingKey,
    scope: Scope,
    value: u64,
    memo: [u8; 512],
) -> sapling::bundle::OutputDescription<sapling::bundle::GrothProofBytes> {
    let fvk = key.sapling().unwrap();
    let address = if scope == Scope::External {
        fvk.default_address().1
    } else {
        fvk.change_address().1
    };
    let note = address.create_note(
        sapling::value::NoteValue::from_raw(value),
        sapling::Rseed::AfterZip212([5; 32]),
    );
    let cmu = note.cmu();
    let cv = sapling::value::ValueCommitment::derive(
        sapling::value::NoteValue::from_raw(value),
        sapling::value::ValueCommitTrapdoor::from_bytes([1; 32]).unwrap(),
    );
    let mut rng = ChaCha20Rng::from_seed([7; 32]);
    let encryption = sapling::note_encryption::sapling_note_encryption(
        Some(fvk.fvk().ovk),
        note,
        memo,
        &mut rng,
    );
    sapling::bundle::OutputDescription::from_parts(
        cv.clone(),
        cmu,
        sapling::note_encryption::SaplingDomain::epk_bytes(encryption.epk()),
        encryption.encrypt_note_plaintext().0,
        encryption.encrypt_outgoing_plaintext(&cv, &cmu, &mut rng),
        [0; 192],
    )
}
fn action(
    key: &UnifiedFullViewingKey,
    scope: Scope,
    value: u64,
    memo: [u8; 512],
    ironwood: bool,
) -> Action<redpallas::Signature<redpallas::SpendAuth>> {
    action_with_sender(key, key, scope, value, memo, ironwood)
}
fn action_with_sender(
    key: &UnifiedFullViewingKey,
    sender: &UnifiedFullViewingKey,
    scope: Scope,
    value: u64,
    memo: [u8; 512],
    ironwood: bool,
) -> Action<redpallas::Signature<redpallas::SpendAuth>> {
    let fvk = key.orchard().unwrap();
    let address = fvk.address_at(0u32, scope);
    let nf = Nullifier::from_bytes(&[1; 32]).unwrap();
    let rho = Rho::from_bytes(&[1; 32]).unwrap();
    let seed = RandomSeed::from_bytes([2; 32], &rho).unwrap();
    let note = Note::from_parts(
        address,
        NoteValue::from_raw(value),
        rho,
        seed,
        if ironwood {
            NoteVersion::V3
        } else {
            NoteVersion::V2
        },
    )
    .unwrap();
    let cmx = ExtractedNoteCommitment::from(note.commitment());
    let cv = ValueCommitment::derive(
        NoteValue::from_raw(value) - NoteValue::ZERO,
        ValueCommitTrapdoor::from_bytes([1; 32]).unwrap(),
    );
    let mut rng = ChaCha20Rng::from_seed([9; 32]);
    let ciphertext = if ironwood {
        let e = IronwoodNoteEncryption::new(
            Some(sender.orchard().unwrap().to_ovk(Scope::External)),
            note,
            memo,
        );
        TransmittedNoteCiphertext {
            epk_bytes: IronwoodDomain::epk_bytes(e.epk()).0,
            enc_ciphertext: e.encrypt_note_plaintext(),
            out_ciphertext: e.encrypt_outgoing_plaintext(&cv, &cmx, &mut rng),
        }
    } else {
        let e = OrchardNoteEncryption::new(
            Some(sender.orchard().unwrap().to_ovk(Scope::External)),
            note,
            memo,
        );
        TransmittedNoteCiphertext {
            epk_bytes: OrchardDomain::epk_bytes(e.epk()).0,
            enc_ciphertext: e.encrypt_note_plaintext(),
            out_ciphertext: e.encrypt_outgoing_plaintext(&cv, &cmx, &mut rng),
        }
    };
    let sk = redpallas::SigningKey::<redpallas::SpendAuth>::try_from([3; 32]).unwrap();
    Action::from_parts(nf, (&sk).into(), cmx, ciphertext, cv, [0; 64].into()).unwrap()
}
fn bundle(
    actions: Vec<Action<redpallas::Signature<redpallas::SpendAuth>>>,
    ironwood: bool,
) -> Bundle<Authorized, ZatBalance> {
    let version = if ironwood {
        BundleVersion::ironwood_v3()
    } else {
        BundleVersion::orchard_v3()
    };
    let proof = Proof::new(vec![0; Proof::expected_proof_size(actions.len())]);
    Bundle::try_from_parts(
        NonEmpty::from_vec(actions).unwrap(),
        version.default_flags(),
        ZatBalance::zero(),
        Anchor::empty_tree(),
        Authorized::from_parts(proof, [0; 64].into()),
        version,
    )
    .unwrap()
}
pub(super) fn fixture() -> (String, ScanRequest) {
    fixture_with_coinbase(false)
}
fn fixture_with_coinbase(coinbase: bool) -> (String, ScanRequest) {
    let ours = key(11);
    let other = key(22);
    let mut no_memo = [0; 512];
    no_memo[0] = 0xf6;
    let sapling = sapling::Bundle::from_parts(
        vec![],
        vec![
            sapling_output(&ours, Scope::External, 123456789, [0; 512]),
            sapling_output(&other, Scope::External, 999, [0x31; 512]),
            sapling_output(&ours, Scope::External, 2, [0xff; 512]),
            sapling_output(&ours, Scope::Internal, 3, no_memo),
            sapling_output(&ours, Scope::External, 0, [0; 512]),
        ],
        ZatBalance::zero(),
        sapling::bundle::Authorized {
            binding_sig: [0; 64].into(),
        },
    );
    let orchard = bundle(
        vec![
            action(&ours, Scope::External, 4, [0x41; 512], false),
            action(&other, Scope::External, 8, [0; 512], false),
            action_with_sender(&other, &ours, Scope::External, 9, [0x77; 512], false),
        ],
        false,
    );
    let ironwood = bundle(
        vec![
            action(&ours, Scope::External, 5, [0x42; 512], true),
            action(&ours, Scope::Internal, 6, [0; 512], true),
        ],
        true,
    );
    let transparent = coinbase.then(|| zcash_transparent::bundle::Bundle {
        vin: vec![zcash_transparent::bundle::TxIn::from_parts(
            zcash_transparent::bundle::OutPoint::NULL,
            Default::default(),
            u32::MAX,
        )],
        vout: vec![],
        authorization: zcash_transparent::bundle::Authorized,
    });
    let tx = TransactionData::<zcash_primitives::transaction::Authorized>::from_parts_v6(
        BranchId::Nu6_3,
        0,
        BlockHeight::from_u32(4_200_100),
        transparent,
        sapling,
        Some(orchard),
        Some(ironwood),
    )
    .freeze()
    .unwrap();
    let mut raw = vec![];
    tx.write(&mut raw).unwrap();
    (
        ours.encode(&TEST_NETWORK).unwrap(),
        ScanRequest {
            protocol_version: 1,
            request_id: 1,
            network: "testnet".into(),
            height: 4_200_000,
            txid: tx.txid().to_string(),
            raw: hex::encode(raw),
        },
    )
}
#[test]
fn decrypts_three_pools_exact_values_receivers_memos_and_unique_output_identities() {
    let (key_text, q) = fixture();
    let scanner = Scanner::new("fixture", &key_text).unwrap();
    let result = scanner.scan(&q).unwrap();
    assert!(result.complete);
    assert_eq!(result.receipts.len(), 6);
    assert_eq!(
        result
            .receipts
            .iter()
            .map(|r| (
                r.pool.as_str(),
                r.output_index,
                r.value_zat.as_str(),
                r.scope.as_str()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("sapling", 0, "123456789", "external"),
            ("sapling", 2, "2", "external"),
            ("sapling", 3, "3", "internal"),
            ("orchard", 0, "4", "external"),
            ("ironwood", 0, "5", "external"),
            ("ironwood", 1, "6", "internal")
        ]
    );
    assert_eq!(result.receipts[0].memo_hex, "00".repeat(512));
    assert_eq!(result.receipts[1].memo_hex, "ff".repeat(512));
    assert_eq!(
        result.receipts[2].memo_hex,
        format!("f6{}", "00".repeat(511))
    );
    let ours = key(11);
    assert_eq!(
        result.receipts[0].receiver,
        hex::encode(ours.sapling().unwrap().default_address().1.to_bytes())
    );
    assert_eq!(
        result.receipts[4].receiver,
        hex::encode(
            ours.orchard()
                .unwrap()
                .address_at(0u32, Scope::External)
                .to_raw_address_bytes()
        )
    );
    let ids = result
        .receipts
        .iter()
        .map(|r| &r.id)
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(ids.len(), 6);
    assert!(result.receipts.iter().all(|r| r.origin == "unknown"));
    assert_eq!(scanner.scan(&q).unwrap().receipts, result.receipts);
    assert_eq!(
        Scanner::new("fixture", &key_text)
            .unwrap()
            .scan(&q)
            .unwrap()
            .receipts,
        result.receipts
    );
    assert!(
        Scanner::new("unrelated", &key(33).encode(&TEST_NETWORK).unwrap())
            .unwrap()
            .scan(&q)
            .unwrap()
            .receipts
            .is_empty()
    );
}
#[test]
fn rejects_malformed_mismatched_and_wrong_network_inputs_without_echoing_secrets() {
    let (key_text, q) = fixture();
    let scanner = Scanner::new("fixture", &key_text).unwrap();
    let mut bad = q.clone();
    bad.raw.push_str("00");
    assert_eq!(
        scanner.scan(&bad).unwrap_err().0,
        "TRAILING_TRANSACTION_BYTES"
    );
    let mut bad = q.clone();
    bad.txid = "ff".repeat(32);
    assert_eq!(scanner.scan(&bad).unwrap_err().0, "TRANSACTION_ID_MISMATCH");
    let mut bad = q.clone();
    bad.height = 4_000_000;
    assert_eq!(
        scanner.scan(&bad).unwrap_err().0,
        "TRANSACTION_BRANCH_HEIGHT_MISMATCH"
    );
    let mut bad = q.clone();
    bad.network = "mainnet".into();
    assert_eq!(
        scanner.scan(&bad).unwrap_err().0,
        "SCANNER_PROTOCOL_OR_NETWORK_MISMATCH"
    );
    let mut bad = q.clone();
    bad.raw.truncate(100);
    assert!(scanner.scan(&bad).is_err());
    let main = key(11)
        .encode(&zcash_protocol::consensus::MAIN_NETWORK)
        .unwrap();
    assert_eq!(
        Scanner::new("fixture", &main).err().unwrap().0,
        "INVALID_TESTNET_UFVK"
    );
    assert_eq!(
        Scanner::new("fixture", "seed phrase is not a viewing key")
            .err()
            .unwrap()
            .0,
        "INVALID_TESTNET_UFVK"
    );
}
#[test]
#[ignore = "explicit offline fixture regeneration only"]
fn regenerate_public_fixture() {
    let (ufvk, request) = fixture();
    let value = serde_json::json!({"warning":"PUBLIC UNFUNDED CRYPTOGRAPHIC FIXTURE; PLACEHOLDER PROOFS; NEVER BROADCAST","ufvk":ufvk,"account_id":"fixture","request":request,
      "expected":[["sapling",0,"123456789","external"],["sapling",2,"2","external"],["sapling",3,"3","internal"],["orchard",0,"4","external"],["ironwood",0,"5","external"],["ironwood",1,"6","internal"]]});
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("shielded.json"),
        serde_json::to_vec_pretty(&value).unwrap(),
    )
    .unwrap();
}

#[test]
fn receipt_preserves_coinbase_marker_separately_from_note_scope() {
    let (key, q) = fixture_with_coinbase(true);
    let notes = Scanner::new("fixture", &key)
        .unwrap()
        .scan(&q)
        .unwrap()
        .receipts;
    assert_eq!(notes.len(), 6);
    assert!(notes.iter().all(|n| n.is_coinbase));
    let (key, q) = fixture();
    assert!(Scanner::new("fixture", &key)
        .unwrap()
        .scan(&q)
        .unwrap()
        .receipts
        .iter()
        .all(|n| !n.is_coinbase));
}
