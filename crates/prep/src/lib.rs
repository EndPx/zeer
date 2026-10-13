//! Experimental immutable compact-block snapshots; not a live wallet service.
pub mod follow;
pub mod follower;
pub mod full_source;
pub mod http;
pub mod importer;
pub mod query;
pub mod server;

pub const MAX_BLOCK_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_DATASET_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_GRPC_BYTES: usize = 8 * 1024 * 1024;
