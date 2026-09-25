"""Stable identity for the exact landmark extraction contract used by a dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections.abc import Mapping
from pathlib import Path

CAPTURE_SCHEMA_VERSION = "1.1"
_SHA256 = re.compile(r"^[a-fA-F0-9]{64}$")
_GROUPS = ("pose", "leftHand", "rightHand", "face")


def capture_contract_payload(
    *,
    preprocess_version,
    landmark_indices,
    model_version,
    runtime_version,
    runtime_sha256,
    model_sha256,
    wasm_files,
):
    if not isinstance(preprocess_version, str) or not preprocess_version.strip():
        raise ValueError("a pinned preprocessing version is required")
    if not isinstance(landmark_indices, Mapping) or any(
        not isinstance(landmark_indices.get(group), list)
        or any(not isinstance(index, int) or isinstance(index, bool) or index < 0
               for index in landmark_indices[group])
        for group in _GROUPS
    ):
        raise ValueError("an ordered landmark layout is required")
    if not isinstance(model_version, str) or not model_version.strip():
        raise ValueError("a pinned MediaPipe model version is required")
    if not isinstance(runtime_version, str) or not runtime_version.strip():
        raise ValueError("a pinned MediaPipe runtime version is required")
    if not isinstance(runtime_sha256, str) or not _SHA256.fullmatch(runtime_sha256):
        raise ValueError("a verified MediaPipe runtime SHA-256 is required")
    if not isinstance(model_sha256, str) or not _SHA256.fullmatch(model_sha256):
        raise ValueError("a verified MediaPipe model SHA-256 is required")
    if not isinstance(wasm_files, list) or len(wasm_files) < 2:
        raise ValueError("verified WASM loader and binary hashes are required")
    normalized_wasm_files = []
    seen_paths = set()
    for item in wasm_files:
        if not isinstance(item, Mapping):
            raise ValueError("each WASM asset must declare a relative path and SHA-256")
        path = item.get("path")
        digest = item.get("sha256")
        if (not isinstance(path, str) or not path.strip() or path.startswith("/")
                or not re.fullmatch(r"[A-Za-z0-9._/-]+", path)
                or re.match(r"^[a-z][a-z0-9+.-]*:", path, re.IGNORECASE)
                or any(part in ("", ".", "..") for part in path.split("/"))):
            raise ValueError("WASM asset paths must be safe paths relative to the local WASM folder")
        if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            raise ValueError("every WASM asset must have a SHA-256 value")
        if path in seen_paths:
            raise ValueError("WASM asset paths must be unique")
        seen_paths.add(path)
        normalized_wasm_files.append({"path": path, "sha256": digest.lower()})
    normalized_wasm_files.sort(key=lambda item: item["path"])
    return {
        "schemaVersion": CAPTURE_SCHEMA_VERSION,
        "preprocessVersion": preprocess_version,
        "landmarkIndices": {group: list(landmark_indices[group]) for group in _GROUPS},
        "modelVersion": model_version,
        "runtimeVersion": runtime_version,
        "runtimeSha256": runtime_sha256.lower(),
        "modelSha256": model_sha256.lower(),
        "wasmFiles": normalized_wasm_files,
    }


def capture_contract_sha256(
    *,
    preprocess_version,
    landmark_indices,
    model_version,
    runtime_version,
    runtime_sha256,
    model_sha256,
    wasm_files,
):
    payload = capture_contract_payload(
        preprocess_version=preprocess_version,
        landmark_indices=landmark_indices,
        model_version=model_version,
        runtime_version=runtime_version,
        runtime_sha256=runtime_sha256,
        model_sha256=model_sha256,
        wasm_files=wasm_files,
    )
    canonical_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def capture_contract_sha256_from_manifest(manifest):
    if not isinstance(manifest, Mapping):
        raise ValueError("approval manifest must be an object")
    return capture_contract_sha256(
        preprocess_version=manifest.get("preprocessVersion"),
        landmark_indices=manifest.get("landmarkIndices"),
        model_version=manifest.get("mediaPipeModelVersion"),
        runtime_version=manifest.get("mediaPipeRuntimeVersion"),
        runtime_sha256=manifest.get("mediaPipeRuntimeSha256"),
        model_sha256=manifest.get("mediaPipeModelSha256"),
        wasm_files=manifest.get("mediaPipeWasmFiles"),
    )


def _main(argv=None):
    parser = argparse.ArgumentParser(description="Calculate the fixed capture-contract SHA-256 for an approval manifest")
    parser.add_argument("--manifest", required=True, help="Approval manifest with final extraction/runtime identities")
    args = parser.parse_args(argv)
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    print(capture_contract_sha256_from_manifest(manifest))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
