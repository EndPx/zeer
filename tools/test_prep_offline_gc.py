"""Deletion safety tests use isolated temporary archives, never a deployment."""
import json
import fcntl
import os
from pathlib import Path
import tempfile
import unittest

from prep_offline_gc import apply, digest


class OfflineGCTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "archive"
        self.audit = self.base / "audit"
        self.audit.mkdir()
        self.retired = self.root / "segments" / "old"
        self.retired.mkdir(parents=True)
        for name, content in [("segment.bin", b"redundant-payload"), ("manifest.json", b"manifest"), ("source.json", b"source")]:
            (self.retired / name).write_bytes(content)
        (self.root / "archive.lock").touch()
        (self.root / "catalog.json").write_text('{"segments":[{"directory":"segments/active"}]}')
        self.proof = self.base / "proof.json"
        value = {"status": "PASS", "catalog_file_sha256": digest(self.root / "catalog.json"),
                 "eligible_bytes": sum(f.stat().st_size for f in self.retired.iterdir()),
                 "eligible": [{"directory": "segments/old", "files": [{"name": f.name, "bytes": f.stat().st_size,
                     "sha256": digest(f)} for f in self.retired.iterdir()]}]}
        self.proof.write_text(json.dumps(value))

    def run_apply(self, pids=None):
        return apply(self.root, self.proof, digest(self.proof), self.audit, pids or [2**30])

    def test_only_redundant_directory_removed_and_metadata_verified(self):
        catalog = (self.root / "catalog.json").read_bytes()
        result = self.run_apply()
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["reclaimedBytes"], len(b"redundant-payloadmanifestsource"))
        self.assertFalse(self.retired.exists())
        self.assertEqual((self.root / "catalog.json").read_bytes(), catalog)
        self.assertTrue((self.audit / "retired-metadata.tar.gz").is_file())

    def test_changed_bytes_are_preserved(self):
        (self.retired / "segment.bin").write_bytes(b"other")
        with self.assertRaisesRegex(RuntimeError, "target bytes changed"):
            self.run_apply()
        self.assertTrue(self.retired.exists())
        self.assertFalse((self.audit / "gc-journal.jsonl").exists())

    def test_active_reference_is_preserved(self):
        (self.root / "catalog.json").write_text('{"segments":[{"directory":"segments/old"}]}')
        value = json.loads(self.proof.read_text())
        value["catalog_file_sha256"] = digest(self.root / "catalog.json")
        self.proof.write_text(json.dumps(value))
        with self.assertRaisesRegex(RuntimeError, "active or repeated"):
            self.run_apply()
        self.assertTrue(self.retired.exists())

    def test_live_reader_or_symlink_is_preserved(self):
        with self.assertRaisesRegex(RuntimeError, "old reader PID still exists"):
            self.run_apply([os.getpid()])
        target = self.retired / "source.json"
        target.unlink()
        target.symlink_to(self.proof)
        with self.assertRaisesRegex(RuntimeError, "target bytes changed"):
            self.run_apply()
        self.assertTrue(target.is_symlink())
        self.assertTrue(self.proof.exists())

    def test_writer_lock_and_catalog_pin_are_enforced(self):
        with (self.root / "archive.lock").open("rb") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.run_apply()
        (self.root / "catalog.json").write_text('{"segments":[]}')
        with self.assertRaisesRegex(RuntimeError, "catalog changed since proof"):
            self.run_apply()
        self.assertTrue(self.retired.exists())

    def test_path_traversal_and_extra_files_are_rejected(self):
        value = json.loads(self.proof.read_text())
        value["eligible"][0]["directory"] = "segments/../../outside"
        self.proof.write_text(json.dumps(value))
        with self.assertRaisesRegex(RuntimeError, "invalid directory name"):
            self.run_apply()
        value["eligible"][0]["directory"] = "segments/old"
        self.proof.write_text(json.dumps(value))
        (self.retired / "unexpected").write_text("keep me")
        with self.assertRaisesRegex(RuntimeError, "target file set changed"):
            self.run_apply()
        self.assertTrue((self.retired / "unexpected").exists())


if __name__ == "__main__":
    unittest.main()
