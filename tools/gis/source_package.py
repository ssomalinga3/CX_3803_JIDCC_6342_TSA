"""Verify and safely unpack original inputs; no GIS dependencies or network needed."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
from zipfile import BadZipFile, ZipFile

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "data/cascade-springs-gis"
SOURCES = PACKAGE / "sources"
EXTRACTED = ROOT / ".work/gis-data/extracted"
INPUTS = ("CSNP_GISfiles.zip", "CSNP Trail Map.pdf", "Cell Signal Strength.png")
MAX_MEMBER_BYTES = 128 * 1024 * 1024
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
WINDOWS_RESERVED_NAMES = {"con", "prn", "aux", "nul"} | {
    f"{prefix}{n}" for prefix in ("com", "lpt") for n in range(1, 10)
}


def sha256(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def file_record(path):
    with path.open("rb") as stream:
        return {"bytes": path.stat().st_size, "sha256": sha256(stream)}


def excluded(path):
    return ".DS_Store" in path.parts or "__MACOSX" in path.parts


def safe_members(archive):
    """Validate the entire directory before writing, including excluded entries."""
    members = archive.infolist()
    seen = {}
    total = 0
    for member in members:
        name = member.filename
        path = PurePosixPath(name)
        parts = name.rstrip("/").split("/")
        if (
            not name
            or path.is_absolute()
            or "\\" in name
            or any(p in ("", ".", "..") or any(c in p for c in ':<>"|?*') for p in parts)
            or any(ord(c) < 32 for c in name)
        ):
            raise ValueError(f"Unsafe archive path: {name!r}")
        # Reject links/devices and Windows aliases before cross-platform extraction.
        mode = member.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError(f"Unsupported archive entry: {name}")
        if any(
            p.endswith((".", " ")) or p.split(".")[0].lower() in WINDOWS_RESERVED_NAMES
            for p in parts
        ):
            raise ValueError(f"Nonportable archive path: {name}")
        key = path.as_posix().casefold()
        if key in seen:
            raise ValueError(f"Duplicate archive path: {name}")
        seen[key] = member.is_dir()
        if member.flag_bits & 1:
            raise ValueError(f"Encrypted archive entry: {name}")
        total += member.file_size
        if member.file_size > MAX_MEMBER_BYTES or total > MAX_ARCHIVE_BYTES:
            raise ValueError("Archive exceeds the documented extraction size limit")
    for key in seen:
        if any(seen.get(parent.as_posix()) is False for parent in PurePosixPath(key).parents):
            raise ValueError(f"Archive file/directory collision: {key}")
    return members


def inventory(sources=SOURCES):
    inputs = [
        {"path": f"data/cascade-springs-gis/sources/{name}", **file_record(sources / name)}
        for name in INPUTS
    ]
    with ZipFile(sources / INPUTS[0]) as archive:
        members = []
        for member in safe_members(archive):
            entry = {
                "path": member.filename,
                "kind": "directory" if member.is_dir() else "file",
                "bytes": member.file_size,
                "zip_modified_at": "%04d-%02d-%02dT%02d:%02d:%02d" % member.date_time,
                "extract": not excluded(PurePosixPath(member.filename)),
            }
            if not member.is_dir():
                with archive.open(member) as stream:
                    entry["sha256"] = sha256(stream)
            members.append(entry)
    return {"inputs": inputs, "archive_members": members}


def verify(package=PACKAGE):
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    if manifest["schema_version"] != 1:
        raise ValueError("Unsupported source manifest schema_version")
    actual = inventory(package / "sources")
    if manifest["inventory"] != actual:
        raise ValueError("Source bytes/archive inventory differ from manifest.json; review the inputs")
    return manifest


def extract_archive(archive_path, destination):
    """Never delete outputs or follow existing symlinks. Identical reruns are safe."""
    if any(p.is_symlink() for p in (destination, *destination.parents)):
        raise ValueError("Extraction destination contains a symlink")
    with ZipFile(archive_path) as archive:
        members = safe_members(archive)
        # Preflight all destinations before any writes, even on an interrupted rerun.
        for member in members:
            target = destination / member.filename
            if any(p.is_symlink() for p in (target, *target.parents)):
                raise ValueError(f"Extraction target contains a symlink: {member.filename}")
            if any(p.exists() and not p.is_dir() for p in target.parents):
                raise ValueError(f"Extraction parent is not a directory: {member.filename}")
            if target.exists() and target.is_dir() != member.is_dir():
                raise ValueError(f"Extraction target type conflict: {member.filename}")
            if target.is_file():
                with archive.open(member) as stream:
                    expected = sha256(stream)
                if file_record(target)["sha256"] != expected:
                    raise ValueError(f"Changed extraction target; move it aside: {member.filename}")
        for member in members:
            if excluded(PurePosixPath(member.filename)):
                continue
            target = destination / member.filename
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            elif not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)


def extract():
    verify()
    extract_archive(SOURCES / INPUTS[0], EXTRACTED)
    return EXTRACTED / "CSNP"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify", "extract", "inventory"))
    args = parser.parse_args()
    try:
        if args.command == "inventory":
            print(json.dumps(inventory(), indent=2))
        elif args.command == "extract":
            print(f"Verified and extracted to {extract().relative_to(ROOT)}")
        else:
            manifest = verify()
            print(f"Verified {len(manifest['inventory']['inputs'])} original inputs and all ZIP members")
    except (OSError, ValueError, KeyError, BadZipFile) as error:
        parser.exit(1, f"GIS source package: {error}\n")


if __name__ == "__main__":
    main()
