"""Findings page API: serves the curated findings files in FINDINGS_DIR (repo data/findings).

    GET /api/findings                 findings.json, written by `python -m concord.findings` (each source
                                      marked `available` when this checkout has the cited file)
    GET /api/findings/self-overlap    self_overlap.json, written by the portfolio overlap audit (404 until it exists)
    GET /api/findings/source?path=..  one source file a finding cites (only paths listed in findings.json)

The page renders these files and nothing else, so no number on it is computed here.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from concord import paths

router = APIRouter(prefix="/api/findings", tags=["findings"])

FINDINGS_FILE = "findings.json"
SELF_OVERLAP_FILE = "self_overlap.json"
# Source files are shown as plain text in the browser; JSON keeps its own type.
_MEDIA = {".json": "application/json", ".py": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
          ".csv": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8"}


def _dir() -> Path:
    # Looked up per request so tests (and a regenerated FINDINGS_DIR) are honoured.
    return paths.FINDINGS_DIR


def _where() -> str:
    try:
        return _dir().resolve().relative_to(paths.ROOT.resolve()).as_posix()
    except ValueError:
        return str(_dir())


def _read(name: str, missing: str) -> dict:
    path = _dir() / name
    if not path.is_file():
        raise HTTPException(404, f"{name} not found in {_where()}: {missing}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(500, f"{name} is not valid JSON: {e}") from e


def _in_checkout(path: str) -> bool:
    """True when a repo-relative path names a file inside this checkout (what /source can serve)."""
    root = paths.ROOT.resolve()
    target = (root / path).resolve()
    return root in target.parents and target.is_file()


@router.get("")
def findings() -> dict:
    """The findings page content (three findings with tables, caveats and sources).

    The file is served as written, except that each source gets `available`: whether this checkout has
    the cited file, so the page shows a missing one as plain text instead of a dead link."""
    doc = _read(FINDINGS_FILE, "run python -m concord.findings to generate it")
    sections = doc.get("findings", []) if isinstance(doc, dict) else []
    for f in sections if isinstance(sections, list) else []:
        for s in (f.get("sources") or []) if isinstance(f, dict) else []:
            if isinstance(s, dict) and isinstance(s.get("path"), str):
                s["available"] = _in_checkout(s["path"])
    return doc


@router.get("/self-overlap")
def self_overlap() -> dict:
    """Headline of the sponsor self-overlap audit, when that workstream has written it."""
    return _read(SELF_OVERLAP_FILE, "the portfolio overlap audit has not written it yet")


def _cited_paths() -> set[str]:
    cited: set[str] = set()
    for name in (FINDINGS_FILE, SELF_OVERLAP_FILE):
        path = _dir() / name
        if not path.is_file():
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            continue
        sections = doc.get("findings", []) if isinstance(doc, dict) else []
        sources = [s for f in sections if isinstance(f, dict) for s in f.get("sources", []) or []]
        if isinstance(doc, dict):
            sources += doc.get("sources", []) or []
        cited |= {s["path"] for s in sources if isinstance(s, dict) and isinstance(s.get("path"), str)}
    return cited


@router.get("/source")
def source(path: str = Query(..., description="repo-relative path exactly as a finding's sources list it")):
    """A file a finding cites. Only paths listed in the findings files are served, and only inside the repo."""
    if path not in _cited_paths():
        raise HTTPException(404, f"{path} is not a source cited by the findings")
    if not _in_checkout(path):
        raise HTTPException(404, f"{path} is not available in this checkout")
    target = (paths.ROOT.resolve() / path).resolve()
    return FileResponse(target, media_type=_MEDIA.get(target.suffix.lower(), "text/plain; charset=utf-8"))
