mod build_provenance;

fn main() {
    let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    for path in [
        "build.rs",
        "build_provenance.rs",
        "src",
        "../../Cargo.toml",
        "../../Cargo.lock",
        "../../rust-toolchain.toml",
        "../../rust-toolchain",
        "../../.cargo",
        "../prep-store",
        "../prep-proto",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }
    let provenance = build_provenance::detect(&manifest);
    for path in &provenance.watch {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    println!("cargo:rustc-env=PREP_BUILD_COMMIT={}", provenance.commit);
    println!("cargo:rustc-env=PREP_SOURCE_STATE={}", provenance.state);
}
