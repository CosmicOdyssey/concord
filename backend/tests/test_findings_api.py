"""Findings page API (concord.api.findings). The router tests use a temporary FINDINGS_DIR and need
no database; the contract test reads the repo's data/findings/findings.json and is skipped without it."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from concord import paths
from concord.api import findings as F

STATUSES = {"final", "provisional", "missing"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "FINDINGS_DIR", tmp_path)
    app = FastAPI()
    app.include_router(F.router)
    return TestClient(app), tmp_path


def test_missing_files_are_404_with_a_message(client):
    c, _ = client
    r = c.get("/api/findings")
    assert r.status_code == 404 and "python -m concord.findings" in r.json()["detail"]
    r = c.get("/api/findings/self-overlap")
    assert r.status_code == 404 and "self_overlap.json" in r.json()["detail"]


def test_serves_files_verbatim(client):
    c, d = client
    doc = {"generated_at": "x", "rule": "r", "findings": [{"id": "congestion", "headline": "beta ≈ 0.09"}]}
    (d / "findings.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    (d / "self_overlap.json").write_text(json.dumps({"headline": "3 pairs"}), encoding="utf-8")
    assert c.get("/api/findings").json() == doc
    assert c.get("/api/findings/self-overlap").json() == {"headline": "3 pairs"}


def test_invalid_json_is_500(client):
    c, d = client
    (d / "findings.json").write_text("{not json", encoding="utf-8")
    assert c.get("/api/findings").status_code == 500


def test_source_serves_only_cited_repo_files(client):
    c, d = client
    cited = "backend/concord/paths.py"
    doc = {"findings": [{"id": "x", "sources": [{"label": "paths", "path": cited},
                                                {"label": "outside", "path": "../../etc/hosts"}]}]}
    (d / "findings.json").write_text(json.dumps(doc), encoding="utf-8")
    r = c.get("/api/findings/source", params={"path": cited})
    assert r.status_code == 200 and "FINDINGS_DIR" in r.text
    assert r.headers["content-type"].startswith("text/plain")
    # Not cited, or cited but outside the repo: refused.
    assert c.get("/api/findings/source", params={"path": "backend/concord/service.py"}).status_code == 404
    assert c.get("/api/findings/source", params={"path": "../../etc/hosts"}).status_code == 404


real = paths.FINDINGS_DIR / "findings.json"


@pytest.mark.skipif(not real.exists(), reason="data/findings/findings.json not generated")
def test_repo_findings_match_the_page_contract():
    """What FindingsView renders: ids, statuses, CI charts, tables with in-range highlight rows, sources."""
    d = json.loads(real.read_text(encoding="utf-8"))
    assert isinstance(d["rule"], str) and d["rule"]
    assert [f["id"] for f in d["findings"]] == ["congestion", "allocation", "implication"]
    for f in d["findings"]:
        assert f["status"] in STATUSES and f["title"] and f["headline"]
        chart = f.get("chart")
        if chart:
            assert chart["type"] == "ci" and isinstance(chart["reference"]["value"], (int, float))
            for it in chart["items"]:
                assert it["lo"] <= it["estimate"] <= it["hi"]
        for t in f.get("tables", []):
            assert all(len(row) == len(t["columns"]) for row in t["rows"]), t["id"]
            if t.get("highlight_row") is not None:
                assert 0 <= t["highlight_row"] < len(t["rows"])
        for s in f.get("sources", []):
            assert s["label"] and s["path"]


@pytest.mark.skipif(not paths.DB_PATH.exists(), reason="data/concord.db not built")
def test_registered_on_the_app():
    from concord.api.main import app
    routes = set(app.openapi()["paths"])
    assert {"/api/findings", "/api/findings/self-overlap", "/api/findings/source"} <= routes
    if real.exists():
        c = TestClient(app)
        assert c.get("/api/findings").json()["findings"][0]["id"] == "congestion"
        src = c.get("/api/findings").json()["findings"][0]["sources"][0]["path"]
        if (paths.ROOT / src).is_file():
            assert c.get("/api/findings/source", params={"path": src}).status_code == 200
