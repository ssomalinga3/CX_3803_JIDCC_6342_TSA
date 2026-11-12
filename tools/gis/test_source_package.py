"""Regression checks for source integrity and archive extraction boundaries."""

import json
from pathlib import Path
import stat
import tempfile
import unittest
from zipfile import ZipFile, ZipInfo

from source_package import INPUTS, extract_archive, inventory, safe_members, verify


class SourcePackageTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name).resolve()
        self.archive = self.root / "source.zip"
        self.output = self.root / "output"

    def write_archive(self, entries):
        with ZipFile(self.archive, "w") as archive:
            for name, content in entries:
                archive.writestr(name, content)

    def test_preserves_structure_bytes_and_safe_reruns_excluding_mac_metadata(self):
        self.write_archive([("CSNP/info/arc.dir", b"original\x00\xff"),
                            ("CSNP/grid/hdr.adf", b"header"),
                            ("CSNP/.DS_Store", b"metadata")])
        extract_archive(self.archive, self.output)
        extract_archive(self.archive, self.output)
        self.assertEqual((self.output / "CSNP/info/arc.dir").read_bytes(), b"original\x00\xff")
        self.assertFalse((self.output / "CSNP/.DS_Store").exists())

    def test_rejects_unsafe_archive_before_writing_any_member(self):
        for unsafe in ("../escape", "/absolute", "CSNP/../escape", "C:/escape",
                       "CSNP\\escape", "CSNP/./file", "CSNP//file", "CSNP/CON.txt"):
            with self.subTest(unsafe=unsafe):
                self.write_archive([("CSNP/valid", b"valid"), (unsafe, b"unsafe")])
                with self.assertRaises(ValueError):
                    extract_archive(self.archive, self.output)
                self.assertFalse(self.output.exists())

    def test_rejects_case_collisions_and_file_directory_collisions(self):
        for entries in ([('CSNP/file', b'a'), ('CSNP/FILE', b'b')],
                        [('CSNP/file', b'a'), ('CSNP/file/child', b'b')]):
            self.write_archive(entries)
            with self.assertRaises(ValueError):
                extract_archive(self.archive, self.output)
            self.assertFalse(self.output.exists())

    def test_rejects_archive_symlinks_and_oversize_members(self):
        link = ZipInfo("CSNP/link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.write_archive([(link, b"../../escape")])
        with self.assertRaises(ValueError):
            extract_archive(self.archive, self.output)
        with ZipFile(self.archive) as archive:
            archive.infolist()[0].external_attr = 0
            archive.infolist()[0].file_size = 129 * 1024 * 1024
            with self.assertRaises(ValueError):
                safe_members(archive)

    def test_existing_destination_symlink_cannot_escape(self):
        self.write_archive([("CSNP/file", b"data")])
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        self.output.mkdir()
        try:
            (self.output / "CSNP").symlink_to(elsewhere, target_is_directory=True)
        except OSError:
            self.skipTest("This host cannot create symlinks")
        with self.assertRaises(ValueError):
            extract_archive(self.archive, self.output)
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_modified_extraction_is_not_overwritten(self):
        self.write_archive([("CSNP/file", b"original")])
        extract_archive(self.archive, self.output)
        (self.output / "CSNP/file").write_bytes(b"edited")
        with self.assertRaisesRegex(ValueError, "move it aside"):
            extract_archive(self.archive, self.output)
        self.assertEqual((self.output / "CSNP/file").read_bytes(), b"edited")

    def test_existing_parent_file_is_rejected_before_any_writes(self):
        self.write_archive([("CSNP/first", b"original"), ("CSNP/blocked/child", b"data")])
        (self.output / "CSNP").mkdir(parents=True)
        (self.output / "CSNP/blocked").write_bytes(b"keep")
        with self.assertRaisesRegex(ValueError, "parent"):
            extract_archive(self.archive, self.output)
        self.assertFalse((self.output / "CSNP/first").exists())
        self.assertEqual((self.output / "CSNP/blocked").read_bytes(), b"keep")

    def test_inventory_detects_changed_original_and_changed_member_metadata(self):
        sources = self.root / "sources"
        sources.mkdir()
        self.write_archive([("CSNP/file", b"original")])
        (sources / INPUTS[0]).write_bytes(self.archive.read_bytes())
        for name in INPUTS[1:]:
            (sources / name).write_bytes(b"input")
        manifest = {"schema_version": 1, "inventory": inventory(sources)}
        path = self.root / "manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        verify(self.root)
        (sources / INPUTS[1]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "differ"):
            verify(self.root)
        (sources / INPUTS[1]).write_bytes(b"input")
        manifest["inventory"]["archive_members"][0]["sha256"] = "0" * 64
        path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "differ"):
            verify(self.root)


if __name__ == "__main__":
    unittest.main()
