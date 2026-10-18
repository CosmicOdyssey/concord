"""Validate current documentation paths/anchors and exact research preservation."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[3]
README = ROOT / "README.md"
FILES = [README, ROOT / "docs/portfolio/README.md", ROOT / "docs/research/README.md",
    ROOT / "docs/reference/ARCHITECTURE-AND-API.md", ROOT / "docs/demo/HACKHARVARD-180-SECOND-SCRIPT.md",
    ROOT / "docs/demo/final-polish/VERIFICATION.md"]


def anchors(text):
    seen = {}
    result = set()
    for heading in re.findall(r"^#{1,6}\s+(.+?)\s*#*$", text, re.M):
        heading = re.sub(r"[`*_]", "", heading).lower().strip()
        slug = "".join(c for c in heading if c in " -_" or unicodedata.category(c)[0] in "LN").replace(" ", "-")
        n = seen.get(slug, 0)
        seen[slug] = n + 1
        result.add(slug if n == 0 else f"{slug}-{n}")
    return result


checked = 0
external = []
for source in FILES:
    text = source.read_text()
    for target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", text):
        url = urlsplit(target)
        if url.scheme in ("http", "https"):
            external.append(target)
            continue
        path = (source.parent / unquote(url.path)).resolve() if url.path else source
        assert path.is_relative_to(ROOT) and path.is_file(), (source, target)
        if url.fragment:
            assert unquote(url.fragment) in anchors(path.read_text()), (source, target, "missing anchor")
        checked += 1
manifest = json.loads((ROOT / "docs/demo/final-polish/research-preservation.json").read_text())
old = subprocess.check_output(["git", "show", manifest["source_commit"] + ":README.md"], cwd=ROOT, text=True)
body = old[old.index(manifest["section_start"]):old.index(manifest["section_end_exclusive"])]
archive = (ROOT / manifest["preserved_file"]).read_text()
assert archive.split("<!-- BEGIN PRESERVED README RESEARCH -->\n", 1)[1].split("<!-- END PRESERVED README RESEARCH -->", 1)[0] == body
assert hashlib.sha256(body.encode()).hexdigest() == manifest["research_excerpt_sha256"]
print(json.dumps({"local_paths_and_anchors_checked": checked, "research_preserved_verbatim": True,
    "external_links": sorted(set(external)), "external_note": "HTTP/route status checks are recorded separately; this validates local paths and anchors."}, indent=2))
