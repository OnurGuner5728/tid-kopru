"""Safely repack a Vosk model ZIP as a browser-compatible tar.gz archive."""

from __future__ import annotations

import argparse
import gzip
import os
import stat
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath


def _validated_members(archive: zipfile.ZipFile) -> tuple[str, list[tuple[zipfile.ZipInfo, tuple[str, ...]]]]:
    members: list[tuple[zipfile.ZipInfo, tuple[str, ...]]] = []
    roots: set[str] = set()
    seen: set[tuple[str, ...]] = set()

    for info in archive.infolist():
        name = info.filename
        if not name or "\x00" in name or "\\" in name:
            raise ValueError(f"Unsafe ZIP member path: {name!r}")

        posix_path = PurePosixPath(name)
        windows_path = PureWindowsPath(name)
        if posix_path.is_absolute() or windows_path.is_absolute() or windows_path.drive:
            raise ValueError(f"Unsafe ZIP member path: {name!r}")

        raw_parts = name.split("/")
        if raw_parts[-1] == "":
            raw_parts = raw_parts[:-1]
        if not raw_parts or any(part in {"", ".", ".."} for part in raw_parts):
            raise ValueError(f"Unsafe ZIP member path: {name!r}")

        path_parts = tuple(raw_parts)
        if path_parts in seen:
            raise ValueError(f"Duplicate ZIP member path: {name!r}")
        seen.add(path_parts)
        roots.add(path_parts[0])

        mode = info.external_attr >> 16
        file_type = stat.S_IFMT(mode)
        is_directory = info.is_dir()
        if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
            raise ValueError(f"Unsupported ZIP member type: {name!r}")
        if is_directory and file_type == stat.S_IFREG:
            raise ValueError(f"Conflicting ZIP member type: {name!r}")
        if not is_directory and file_type == stat.S_IFDIR:
            raise ValueError(f"Conflicting ZIP member type: {name!r}")
        if len(path_parts) == 1 and not is_directory:
            raise ValueError("The ZIP must contain one top-level model directory")

        members.append((info, path_parts))

    if not members:
        raise ValueError("The ZIP archive is empty")
    if len(roots) != 1:
        raise ValueError("The ZIP must contain exactly one top-level directory")

    root = next(iter(roots))
    if not any(len(parts) == 1 and info.is_dir() for info, parts in members):
        # ZIP writers may omit explicit directory entries; nested members still
        # establish the sole top-level folder unambiguously.
        if not all(len(parts) > 1 for _, parts in members):
            raise ValueError("The ZIP must contain one top-level model directory")
    return root, members


def build_model_archive(source_zip: Path, output_tar_gz: Path) -> tuple[int, int]:
    """Write a deterministic USTAR/GZIP archive rooted at ``model/``.

    Returns the number of regular files and the resulting archive size in bytes.
    The ZIP is validated in full before an output file is created, and the final
    archive replaces its destination atomically after a successful write.
    """
    source = Path(source_zip)
    output = Path(output_tar_gz)
    if source.resolve() == output.resolve():
        raise ValueError("Source ZIP and output archive must be different files")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with zipfile.ZipFile(source, "r") as source_archive:
            _, members = _validated_members(source_archive)

            files_by_target: dict[tuple[str, ...], zipfile.ZipInfo] = {}
            directories: set[tuple[str, ...]] = {("model",)}
            for info, parts in members:
                relative = parts[1:]
                target = ("model", *relative)
                if not relative:
                    continue
                if info.is_dir():
                    directories.add(target)
                else:
                    files_by_target[target] = info
                for depth in range(1, len(target)):
                    directories.add(target[:depth])

            if any(path in files_by_target for path in directories):
                raise ValueError("ZIP contains a path that is both a file and a directory")

            with tempfile.NamedTemporaryFile(
                mode="wb", prefix=f".{output.name}.", suffix=".tmp", dir=output.parent, delete=False
            ) as temporary_file:
                temporary_path = temporary_file.name
                with gzip.GzipFile(filename="", fileobj=temporary_file, mode="wb", mtime=0) as gzip_stream:
                    with tarfile.open(
                        fileobj=gzip_stream, mode="w", format=tarfile.USTAR_FORMAT
                    ) as tar_archive:
                        for path in sorted(directories, key=lambda item: (len(item), item)):
                            tar_info = tarfile.TarInfo("/".join(path))
                            tar_info.type = tarfile.DIRTYPE
                            tar_info.mode = 0o755
                            tar_info.mtime = 0
                            tar_info.uid = 0
                            tar_info.gid = 0
                            tar_info.uname = ""
                            tar_info.gname = ""
                            tar_archive.addfile(tar_info)

                        for path, info in sorted(files_by_target.items()):
                            tar_info = tarfile.TarInfo("/".join(path))
                            tar_info.size = info.file_size
                            tar_info.mode = 0o644
                            tar_info.mtime = 0
                            tar_info.uid = 0
                            tar_info.gid = 0
                            tar_info.uname = ""
                            tar_info.gname = ""
                            with source_archive.open(info, "r") as file_stream:
                                tar_archive.addfile(tar_info, file_stream)

        os.replace(temporary_path, output)
        temporary_path = None
        return len(files_by_target), output.stat().st_size
    finally:
        if temporary_path is not None:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_zip", type=Path, help="Downloaded Vosk model ZIP")
    parser.add_argument("output_tar_gz", type=Path, help="Destination model.tar.gz")
    arguments = parser.parse_args()
    file_count, output_bytes = build_model_archive(arguments.input_zip, arguments.output_tar_gz)
    print(f"Packaged {file_count} files ({output_bytes} bytes) to {arguments.output_tar_gz}")


if __name__ == "__main__":
    main()
