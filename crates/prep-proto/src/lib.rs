//! Pinned upstream client protocol and experimental Prep range API.
pub mod zcash {
    tonic::include_proto!("cash.z.wallet.sdk.rpc");
}
pub mod prep {
    tonic::include_proto!("zeer.prep.v1");
}
