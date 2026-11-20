#!/usr/bin/env python3
"""Reassemble the exact reviewed standalone app from GitHub-safe chunks."""
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "bundle"
PUBLIC = ROOT / "public"
EXPECTED_PARTS = 8
EXPECTED_SIZE = 6761234
EXPECTED_SHA256 = "1b1e9771b4a5348f56ba1a0b4124ef2f59fba94d7b8c8525fac3a80b1521e6c2"

pieces = [BUNDLE / f"meridian.part-{i:03d}" for i in range(EXPECTED_PARTS)]
missing = [str(p) for p in pieces if not p.is_file()]
if missing:
    raise SystemExit("Missing bundle pieces: " + ", ".join(missing))
extra = [p.name for p in BUNDLE.glob("meridian.part-*") if p not in pieces]
if extra:
    raise SystemExit("Unexpected bundle pieces: " + ", ".join(extra))

payload = b"".join(piece.read_bytes() for piece in pieces)
actual = sha256(payload).hexdigest()
if len(payload) != EXPECTED_SIZE or actual != EXPECTED_SHA256:
    raise SystemExit(
        "FAILED: compiled app integrity mismatch. "
        f"bytes={len(payload)} expected={EXPECTED_SIZE}; sha256={actual} expected={EXPECTED_SHA256}"
    )
PUBLIC.mkdir(parents=True, exist_ok=True)
(PUBLIC / ".nojekyll").touch()
(PUBLIC / "index.html").write_bytes(payload)
print(f"PASS: assembled verified Meridian HTML ({len(payload):,} bytes, SHA-256 {actual})")
