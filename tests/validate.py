"""Zero-dependency static security, functionality-marker and isolation checks."""
from pathlib import Path
from html.parser import HTMLParser
from hashlib import sha256
import base64
import re
import argparse
import json
import os
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--artifact", default="public/index.html", help="HTML artifact relative to the repository root")
parser.add_argument("--standalone", action="store_true", help="Validate a portable HTML file rather than a Pages directory")
args = parser.parse_args()
INDEX = ROOT / args.artifact
PUBLIC = INDEX.parent
assert INDEX.is_file(), "Build the specified artifact first"
assert args.standalone or (PUBLIC / ".nojekyll").is_file(), "Missing .nojekyll"
assert not any(ROOT.rglob("CNAME")), "STOP: CNAME would attach a custom domain"

for item in ("README.md", "DEPLOYMENT.md", "AGENTS.md"):
    doc = (ROOT / item).read_text(encoding="utf-8")
    assert "SUaDtL/Meridian" in doc, "Wrong repository scope in " + item
    assert "arbiterforge.github.io/Meridian" not in doc, "Wrong Pages hostname in " + item

html = INDEX.read_text(encoding="utf-8")
assert "<title>Meridian | Diagrams worth presenting</title>" in html
assert '<meta name="robots" content="noindex, nofollow"' in html
assert 'id="root"' in html, "Missing React root"
assert "Content-Security-Policy" in html
assert "connect-src 'none'" in html
assert not re.search(r'(?i)<meta[^>]+http-equiv=["\']refresh', html)

class Collector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.inline = None
        self.external = []
        self.resources = []
        self.policy = None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script":
            if attrs.get("src"):
                self.external.append(attrs["src"])
                assert attrs.get("type") == "module", "Application scripts must be modules"
            else:
                self.inline = []
        if tag in ("link", "img", "iframe", "object", "embed"):
            url = attrs.get("href") or attrs.get("src")
            if url:
                self.resources.append(url)
        if tag == "meta" and attrs.get("http-equiv", "").lower() == "content-security-policy":
            assert self.policy is None, "Multiple CSP declarations"
            self.policy = attrs.get("content")
    def handle_data(self, data):
        if self.inline is not None:
            self.inline.append(data)
    def handle_endtag(self, tag):
        if tag == "script" and self.inline is not None:
            self.scripts.append("".join(self.inline))
            self.inline = None

p = Collector()
p.feed(html)
receipt_path = PUBLIC / "build.json"
receipt = json.loads(receipt_path.read_text()) if receipt_path.is_file() else {}
if receipt.get("format") == "split-v1" and not args.standalone:
    expected_policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'"
    assert p.policy == expected_policy, "Hosted CSP differs from the explicit local-only policy"
    assert not p.scripts, "Hosted build must not execute inline application scripts"
    assert len(p.external) == 1, "Expected one hosted module entry point"
    assert receipt.get("repository") == "SUaDtL/Meridian", "Receipt has wrong repository scope"
    assert receipt.get("artifact") == "index.html", "Receipt has wrong entry point"
    assert isinstance(receipt.get("workingTreeDirty"), bool), "Receipt must distinguish local edits from the recorded commit"
    assert not os.environ.get("CI") or not receipt["workingTreeDirty"], "CI cannot publish a receipt from modified source"
    entries = receipt.get("assets", [])
    indexed = {entry["path"]: entry for entry in entries}
    assert len(indexed) == len(entries), "Receipt contains duplicate asset paths"
    assert set(indexed) == {path.relative_to(PUBLIC).as_posix() for path in PUBLIC.rglob("*") if path.is_file() and path.name != "build.json"}, "Receipt must inventory every deployed file"
    for name, entry in indexed.items():
        path = PUBLIC / name
        assert path.resolve().is_relative_to(PUBLIC.resolve()), "Asset escaped its deployment directory"
        content = path.read_bytes()
        assert len(content) == entry["bytes"], "Asset byte count differs: " + name
        assert sha256(content).hexdigest() == entry["sha256"], "Asset digest differs: " + name
    assert receipt["bytes"] == indexed["index.html"]["bytes"]
    assert receipt["sha256"] == indexed["index.html"]["sha256"]
    assert receipt["totalBytes"] == sum(entry["bytes"] for entry in entries)
    initial = receipt.get("initialAssets", [])
    assert len(initial) == len(set(initial)) and set(initial).issubset(indexed), "Invalid initial asset inventory"
    assert receipt["initialBytes"] == sum(indexed[name]["bytes"] for name in initial), "Initial payload accounting differs"
    # This is the uncompressed welcome budget, not a timing claim. Mermaid and
    # CodeMirror must remain outside the initial dependency graph.
    assert receipt["initialBytes"] < 600_000, "Welcome assets exceeded the 600 KB uncompressed budget"
    for url in p.external + p.resources:
        if url.startswith("data:"):
            continue
        parsed = urlsplit(url)
        assert not parsed.scheme and not parsed.netloc and not parsed.path.startswith("/"), "Runtime resources must use relative local paths: " + url
        name = unquote(parsed.path).removeprefix("./")
        assert name in indexed, "HTML refers to an unverified resource: " + name
    runtime = "".join((PUBLIC / name).read_text() for name in indexed if name.endswith(".js"))
    assert "mermaid" in runtime.lower(), "Missing Mermaid runtime"
    assert any(name.endswith(".txt") and "THIRD-PARTY-NOTICES" in name for name in indexed), "Missing dependency attribution"
    print(f"PASS: split Pages artifact, strict local-only CSP, {len(entries)} verified files, {receipt['initialBytes']:,} initial bytes")
else:
    # The original published reference and optional portable build retain the
    # original single-script hash gate. Hosted splitting does not bypass it.
    assert "mermaid" in html.lower(), "Missing Mermaid runtime"
    assert not p.external, "Unexpected external runtime resource: " + repr(p.external)
    assert all(url.startswith("data:") for url in p.resources), "Portable HTML contains an external runtime asset"
    assert len(p.scripts) == 1, "Expected a single self-contained module script"
    digest = base64.b64encode(sha256(p.scripts[0].encode("utf-8")).digest()).decode()
    assert f"'sha256-{digest}'" in html, "CSP script hash mismatch"
    print("PASS: independent portable artifact, intact inline script CSP, no external runtime assets or custom domain")
