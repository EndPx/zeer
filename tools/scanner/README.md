# Scanner release

The `scanner-v0.1.0-testnet.1` release targets **Linux x64 with glibc**, including
WSL2 Ubuntu 24.04. It uses scanner protocol 1 and is tested with npm Chef 0.2.0.
The release does not support mainnet. Other architectures, macOS, native Windows
and musl distributions retain the source build path until separately tested.

Release assets are the native binary, the standalone installer, a shielded inbox
starter, `SHA256SUMS`, the exact native source archive and provenance. The binary
has no wallet signing or network API. The installer downloads a fixed GitHub
release asset, verifies its embedded size/SHA-256 **before execution**, then runs
keyless capabilities with a five-second bound. It never reads a viewing key.
Checksums detect changed bytes relative to this trusted release; they are not a
separate signature or third-party attestation.

```sh
node install-scanner.mjs --dir "$HOME/.local/share/zeer"
```

An already-downloaded binary can be verified and installed offline:

```sh
node install-scanner.mjs --file ./zeer-scanner-linux-x64 --dir "$HOME/.local/share/zeer"
```

Install directories are versioned, owner controlled and never overwritten. An
existing matching installation is checked again. Unknown platforms, checksum
changes, incompatible capabilities and failed execution produce fixed error
codes. Do not override a checksum to make an unverified file run.

The build uses the pinned workspace lockfile and Rust toolchain. Record build
image, compiler, source archive, binary hash, native test/lint output and a fresh
registry-SDK installation. The release verifier uses the public unfunded fixture
with placeholder proofs; it is never broadcast and is not a mined receipt.
Separate local WSL verification reads a previously mined owned note without
moving the operator key off the developer computer.

```sh
cargo test --locked -p zeer-scanner
cargo clippy --locked -p zeer-scanner --all-targets -- -D warnings
cargo build --release --locked -p zeer-scanner
node --test tools/scanner/install-scanner.test.mjs
```
