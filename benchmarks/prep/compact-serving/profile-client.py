"""Prepare diagnostic ghz source; this patched client is not the timing baseline."""
import argparse, hashlib, json, tarfile, urllib.request
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", type=Path, required=True)
root = parser.parse_args().out.resolve()
root.mkdir(parents=True, exist_ok=False)
commit = "b7ca8f5fad40d3da97092a8886e4a4f636712069"
archive = root / "ghz-source.tar.gz"
with urllib.request.urlopen("https://codeload.github.com/bojand/ghz/tar.gz/" + commit, timeout=60) as response:
    data = response.read(16 * 1024 * 1024 + 1)
assert len(data) <= 16 * 1024 * 1024, "source archive limit"
archive.write_bytes(data)
with tarfile.open(archive) as source:
    for member in source.getmembers():
        path = Path(member.name)
        assert not path.is_absolute() and ".." not in path.parts
        assert member.isfile() or member.isdir(), "links are not accepted"
    source.extractall(root, filter="data")
source_root = root / ("ghz-" + commit)
main = source_root / "cmd/ghz/main.go"
original = main.read_text()
assert original.count('"runtime"') == 1 and original.count("func main() {") == 1
patched = original.replace('"runtime"', '"runtime"\n"runtime/pprof"', 1).replace("func main() {", '''func main() {
 if name := os.Getenv("ZEER_CLIENT_CPU_PROFILE"); name != "" {
  f, err := os.Create(name); if err != nil { panic(err) }
  if err := pprof.StartCPUProfile(f); err != nil { panic(err) }
  defer func(){ pprof.StopCPUProfile(); f.Close()
   if heap := os.Getenv("ZEER_CLIENT_ALLOC_PROFILE"); heap != "" {
    h, err := os.Create(heap); if err != nil { panic(err) }
    defer h.Close(); if err := pprof.Lookup("allocs").WriteTo(h, 0); err != nil { panic(err) }
   }
  }()
 }
''', 1)
main.write_text(patched)
(root / "source-proof.json").write_text(json.dumps({"commit": commit, "archiveSha256": hashlib.sha256(data).hexdigest(), "originalMainSha256": hashlib.sha256(original.encode()).hexdigest(), "patchedMainSha256": hashlib.sha256(patched.encode()).hexdigest(), "compiler": "Go 1.23.0 matches official binary; verify with go version -m", "scope": "diagnostic hooks only; use original ghz for performance comparisons"}, indent=2))
print(source_root)
