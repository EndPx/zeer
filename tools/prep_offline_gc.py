#!/usr/bin/env python3
"""Apply a pinned retired-segment proof after an operator quiesces ALL readers.

The Rust verifier supplies full-record equivalence, not reader coordination.
This tool never edits catalogs/status, never follows symlinks, and never removes
active, unknown, or proof-retained directories. Requires Linux and stdlib only.
"""
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tarfile
import time


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    require(path.is_file() and not path.is_symlink(), "regular file required")
    with path.open("rb") as stream:
        sha = hashlib.sha256()
        while chunk := stream.read(1024 * 1024):
            sha.update(chunk)
    return sha.hexdigest()


def sync_directory(path):
    fd = os.open(path, os.O_DIRECTORY | os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def archive_bytes(root):
    total = 0
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            require(not (Path(parent) / name).is_symlink(), "archive symlink encountered")
        total += sum((Path(parent) / name).stat().st_size for name in files)
    return total


def apply(root, proof_path, proof_sha256, audit, quiesced_pids):
    require(root.is_absolute() and not root.is_symlink(), "absolute real archive required")
    root = root.resolve(strict=True)
    segment_root = root / "segments"
    require(segment_root.is_dir() and not segment_root.is_symlink(), "real segments directory required")
    require(audit.is_absolute() and not audit.is_symlink(), "absolute real audit directory required")
    audit = audit.resolve(strict=True)
    require(not audit.is_relative_to(root), "audit must be outside archive")
    require(quiesced_pids, "reader PID evidence required")
    require(all(not Path("/proc", str(pid)).exists() for pid in quiesced_pids), "an old reader PID still exists")
    # Defense in depth, not proof of absence of custom readers. Operator must
    # enumerate service processes and container mounts before acknowledging.
    for process in Path("/proc").iterdir():
        if not process.name.isdigit() or int(process.name) == os.getpid():
            continue
        try:
            args = (process / "cmdline").read_bytes().split(b"\0")
            require(bytes(root) not in args, "archive process still running")
        except (FileNotFoundError, ProcessLookupError):
            continue
    require((root / "archive.lock").is_file() and not (root / "archive.lock").is_symlink(), "real archive lock required")
    with (root / "archive.lock").open("rb") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(digest(proof_path) == proof_sha256, "proof file pin mismatch")
        proof = json.loads(proof_path.read_bytes())
        require(proof["status"] == "PASS", "proof did not pass")
        require(digest(root / "catalog.json") == proof["catalog_file_sha256"], "catalog changed since proof")
        catalog = json.loads((root / "catalog.json").read_bytes())
        active = {entry["directory"] for entry in catalog["segments"]}
        eligible = proof["eligible"]
        require(0 < len(eligible) <= 30_000, "invalid eligible count")
        names = set()
        prepared = []
        metadata = {}
        total = 0
        for entry in eligible:
            relative = entry["directory"]
            require(re.fullmatch(r"segments/[A-Za-z0-9_-]{1,128}", relative) is not None, "invalid directory name")
            require(relative not in active and relative not in names, "active or repeated directory")
            names.add(relative)
            path = root / relative
            require(path.is_dir() and not path.is_symlink() and path.resolve().parent == segment_root, "unsafe target path")
            expected = {file["name"] for file in entry["files"]}
            require(2 <= len(entry["files"]) <= 3 and len(expected) == len(entry["files"])
                    and {"segment.bin", "manifest.json"} <= expected
                    and expected <= {"segment.bin", "manifest.json", "source.json"}, "invalid file set")
            require({file.name for file in path.iterdir()} == expected, "target file set changed")
            file_pins = []
            for file in entry["files"]:
                target = path / file["name"]
                stat = target.lstat()
                require(not target.is_symlink() and target.is_file()
                        and stat.st_size == file["bytes"] and digest(target) == file["sha256"], "target bytes changed")
                file_pins.append((target, stat.st_dev, stat.st_ino, stat.st_size))
                total += stat.st_size
                if file["name"] != "segment.bin":
                    metadata[str(target.relative_to(root))] = target.read_bytes()
            prepared.append((path, file_pins))
        require(total == proof["eligible_bytes"], "proof byte total mismatch")
        before = archive_bytes(root)
        metadata["gc-proof.json"] = proof_path.read_bytes()
        metadata["catalog-before.json"] = (root / "catalog.json").read_bytes()
        backup = audit / "retired-metadata.tar.gz"
        # No overwrite of a previous run or ambiguous partial backup.
        with backup.open("xb") as output:
            with tarfile.open(fileobj=output, mode="w:gz") as tar:
                for name, content in metadata.items():
                    info = tarfile.TarInfo(name)
                    info.size = len(content)
                    info.mode = 0o600
                    tar.addfile(info, io.BytesIO(content))
            output.flush()
            os.fsync(output.fileno())
        require(backup.stat().st_size <= 128 * 1024**2, "metadata backup exceeds bounded reserve; nothing deleted")
        with tarfile.open(backup, "r:gz") as tar:
            require(set(tar.getnames()) == set(metadata), "backup file set mismatch")
            for name, content in metadata.items():
                require(tar.extractfile(name).read() == content, "metadata backup readback mismatch")
        sync_directory(audit)
        require(digest(root / "catalog.json") == proof["catalog_file_sha256"], "catalog changed before GC")
        journal = audit / "gc-journal.jsonl"
        with journal.open("x") as output:
            output.write(json.dumps({"event": "prepared", "atUnix": time.time(), "catalogFileSha256": proof["catalog_file_sha256"],
                "proofFileSha256": proof_sha256, "metadataBackupSha256": digest(backup), "quiescedReaderPids": quiesced_pids,
                "directories": len(prepared), "bytes": total}) + "\n")
            output.flush()
            os.fsync(output.fileno())
            for path, pins in prepared:
                require({p.name for p in path.iterdir()} == {p.name for p, _, _, _ in pins}, "target file set raced")
                for target, device, inode, size in pins:
                    stat = target.lstat()
                    require(not target.is_symlink() and (stat.st_dev, stat.st_ino, stat.st_size) == (device, inode, size), "target identity raced")
                # Flat allowlisted files only: no recursive deletion or computed
                # shell command. Every directory was proven unreferenced.
                for target, _, _, _ in pins:
                    target.unlink()
                path.rmdir()
                output.write(json.dumps({"event": "reclaimed", "directory": str(path.relative_to(root))}) + "\n")
            sync_directory(segment_root)
            output.flush()
            os.fsync(output.fileno())
        require(digest(root / "catalog.json") == proof["catalog_file_sha256"], "catalog changed after GC")
        after = archive_bytes(root)
        require(before - after == total, "archive byte delta mismatch")
        result = {"status": "PASS", "atUnix": time.time(), "reclaimedDirectories": len(prepared), "reclaimedBytes": total,
                  "archiveBytesBefore": before, "archiveBytesAfter": after, "catalogFileSha256Unchanged": proof["catalog_file_sha256"],
                  "metadataBackupBytes": backup.stat().st_size, "metadataBackupSha256": digest(backup), "quiescedReaderPids": quiesced_pids,
                  "readerCoordination": "Operator stopped all inventoried readers; no online GC or reader lease guarantee."}
        destination = audit / "gc-result.json"
        with destination.open("x") as output:
            output.write(json.dumps(result, indent=2) + "\n")
            output.flush()
            os.fsync(output.fileno())
        sync_directory(audit)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--proof", required=True, type=Path)
    parser.add_argument("--proof-sha256", required=True)
    parser.add_argument("--audit", required=True, type=Path)
    parser.add_argument("--quiesced-reader-pid", action="append", required=True, type=int)
    parser.add_argument("--all-readers-quiesced", action="store_true", required=True,
                        help="Operator attests all archive readers stopped, including custom processes")
    args = parser.parse_args()
    print(json.dumps(apply(args.archive, args.proof, args.proof_sha256, args.audit, args.quiesced_reader_pid)))


if __name__ == "__main__":
    main()
