fn main() -> Result<(), Box<dyn std::error::Error>> {
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    let mut upstream = prost_build::Config::new();
    upstream.protoc_executable(&protoc);
    tonic_prost_build::configure()
        .build_server(true)
        .generate_default_stubs(true)
        .compile_with_config(upstream, &["proto/service.proto"], &["proto"])?;
    let mut native = prost_build::Config::new();
    native.protoc_executable(protoc);
    tonic_prost_build::configure().compile_with_config(
        native,
        &["proto/prep.proto"],
        &["proto"],
    )?;
    println!("cargo:rerun-if-changed=proto");
    Ok(())
}
