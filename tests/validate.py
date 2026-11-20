"""Zero-dependency static security, functionality-marker and isolation checks."""
from pathlib import Path
from html.parser import HTMLParser
from hashlib import sha256
import base64
import re

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
INDEX = PUBLIC / "index.html"
assert INDEX.is_file(), "Run python3 scripts/assemble.py first"
assert (PUBLIC / ".nojekyll").is_file(), "Missing .nojekyll"
assert not any(ROOT.rglob("CNAME")), "STOP: CNAME would attach a custom domain"

for item in ("README.md", "DEPLOYMENT.md", "AGENTS.md"):
    doc = (ROOT / item).read_text(encoding="utf-8")
    assert "SUaDtL/Meridian" in doc, "Wrong repository scope in " + item
    assert "arbiterforge.github.io/Meridian" not in doc, "Wrong Pages hostname in " + item

html = INDEX.read_text(encoding="utf-8")
assert "<title>Meridian | Diagrams worth presenting</title>" in html
assert '<meta name="robots" content="noindex, nofollow"' in html
assert 'id="root"' in html, "Missing React root"
assert "mermaid" in html.lower(), "Missing Mermaid runtime"
assert "Content-Security-Policy" in html
assert "connect-src 'none'" in html
assert not re.search(r'(?i)<meta[^>]+http-equiv=["\']refresh', html)

class Collector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.inline = None
        self.external = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script":
            if attrs.get("src"):
                self.external.append(attrs["src"])
            else:
                self.inline = []
        if tag in ("link", "img", "iframe", "object", "embed"):
            url = attrs.get("href") or attrs.get("src")
            if url and url.startswith(("https://", "http://", "//")):
                self.external.append(url)
    def handle_data(self, data):
        if self.inline is not None:
            self.inline.append(data)
    def handle_endtag(self, tag):
        if tag == "script" and self.inline is not None:
            self.scripts.append("".join(self.inline))
            self.inline = None

p = Collector()
p.feed(html)
assert not p.external, "Unexpected external runtime resource: " + repr(p.external)
assert len(p.scripts) == 1, "Expected a single self-contained module script"
digest = base64.b64encode(sha256(p.scripts[0].encode("utf-8")).digest()).decode()
assert f"'sha256-{digest}'" in html, "CSP script hash mismatch"
print("PASS: independent GitHub Pages preview, intact inline script CSP, no external runtime assets or custom domain")
