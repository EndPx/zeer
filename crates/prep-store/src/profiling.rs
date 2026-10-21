//! Opt-in synchronous admission instrumentation. Ordinary builds contain no timers.
use crate::{Archive, Result};
use serde::Serialize;
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    path::Path,
    time::Instant,
};

#[derive(Default, Serialize)]
pub struct PhaseTime {
    pub ns: u128,
    pub calls: u64,
}
#[derive(Serialize)]
pub struct AdmissionProfile {
    pub archive_budget_bytes: usize,
    pub segment_budget_bytes: usize,
    pub native_metadata_row_bytes: usize,
    pub native_index_fixed_bytes: usize,
    pub native_offset_bytes: usize,
    pub native_secondary_entry_bytes: usize,
    pub admission_ns: u128,
    pub phases: BTreeMap<&'static str, PhaseTime>,
    pub segments: Vec<SegmentAdmission>,
}
#[derive(Serialize)]
pub struct SegmentAdmission {
    pub directory: String,
    pub index_kind: &'static str,
    pub available_archive_bytes: usize,
    pub allocated_index_bytes: usize,
    pub start_height: u64,
    pub end_height: u64,
}
thread_local! {
    static ACTIVE: RefCell<Option<AdmissionProfile>> = const { RefCell::new(None) };
    static PROGRESS: Cell<Option<Instant>> = const { Cell::new(None) };
}

pub(crate) struct Phase {
    name: &'static str,
    started: Option<Instant>,
}
impl Phase {
    pub(crate) fn new(name: &'static str) -> Self {
        let active = ACTIVE.with(|slot| slot.borrow().is_some());
        Self {
            name,
            started: active.then(Instant::now),
        }
    }
}
impl Drop for Phase {
    fn drop(&mut self) {
        if let Some(started) = self.started {
            let ns = started.elapsed().as_nanos();
            ACTIVE.with(|slot| {
                if let Some(profile) = slot.borrow_mut().as_mut() {
                    let phase = profile.phases.entry(self.name).or_default();
                    phase.ns += ns;
                    phase.calls += 1;
                }
            });
        }
    }
}
pub(crate) fn archive_budget(default: usize) -> usize {
    ACTIVE.with(|slot| {
        slot.borrow()
            .as_ref()
            .map_or(default, |p| p.archive_budget_bytes)
    })
}
pub(crate) fn counter(name: &'static str) {
    ACTIVE.with(|slot| {
        if let Some(profile) = slot.borrow_mut().as_mut() {
            profile.phases.entry(name).or_default().calls += 1;
        }
    });
}
pub(crate) fn segment(directory: &str, available: usize, store: &crate::Store) {
    ACTIVE.with(|slot| {
        if let Some(profile) = slot.borrow_mut().as_mut() {
            profile.segments.push(SegmentAdmission {
                directory: directory.into(),
                index_kind: if store.disk_index.is_some() {
                    "disk"
                } else if store.transaction_index.is_some() {
                    "memory"
                } else {
                    "payload"
                },
                available_archive_bytes: available,
                allocated_index_bytes: store.transaction_index_bytes(),
                start_height: store.manifest().start_height,
                end_height: store.manifest().end_height,
            });
            PROGRESS.with(|progress| {
                if let Some(started) = progress.get() {
                    if profile.segments.len() == 1 || profile.segments.len().is_multiple_of(128) {
                        eprintln!("{}", serde_json::json!({"format":"prep-admission-progress-v1",
                            "elapsed_seconds":started.elapsed().as_secs_f64(),"segments":profile.segments.len(),
                            "last_height":store.manifest().end_height,"phases":profile.phases}));
                    }
                }
            });
        }
    });
}

/// Diagnostic-only progress on stderr; ordinary archive admission is unchanged.
pub fn open_with_progress(
    path: impl AsRef<Path>,
    budget: Option<usize>,
) -> Result<(Archive, AdmissionProfile)> {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            PROGRESS.with(|p| p.set(None));
        }
    }
    PROGRESS.with(|p| {
        assert!(p.get().is_none(), "nested progress profiling");
        p.set(Some(Instant::now()));
    });
    let _reset = Reset;
    open(path, budget)
}

/// Fresh admission using all ordinary integrity checks. A reduced optional budget
/// is a measurement counterfactual, never a release configuration. Timers include
/// instrumentation overhead and do not partition allocator/destructor overhead.
pub fn open(path: impl AsRef<Path>, budget: Option<usize>) -> Result<(Archive, AdmissionProfile)> {
    let default = super::transaction_index::ARCHIVE_INDEX_BYTES;
    let budget = budget.unwrap_or(default);
    if budget > default {
        return Err(crate::Error::Limit("profile budget exceeds default"));
    }
    ACTIVE.with(|slot| {
        assert!(slot.borrow().is_none(), "nested admission profiling");
        *slot.borrow_mut() = Some(AdmissionProfile {
            archive_budget_bytes: budget,
            segment_budget_bytes: super::transaction_index::SEGMENT_INDEX_BYTES,
            native_metadata_row_bytes: std::mem::size_of::<crate::TransactionMetadata>(),
            native_index_fixed_bytes: std::mem::size_of::<super::transaction_index::TransactionIndex>() + 2 * std::mem::size_of::<usize>(),
            native_offset_bytes: std::mem::size_of::<usize>(),
            native_secondary_entry_bytes: std::mem::size_of::<u32>(),
            admission_ns: 0,
            phases: BTreeMap::new(),
            segments: Vec::new(),
        });
    });
    // Clear thread-local state on errors or panic as well as success.
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            ACTIVE.with(|s| {
                s.borrow_mut().take();
            });
        }
    }
    let _reset = Reset;
    let started = Instant::now();
    let archive = Archive::open(path)?;
    let elapsed = started.elapsed().as_nanos();
    let mut profile = ACTIVE.with(|slot| slot.borrow_mut().take().unwrap());
    profile.admission_ns = elapsed;
    Ok((archive, profile))
}
