"""Verify a real browser-observed saved run and materialize its report for replay.

Run from repository root:
backend/.venv/bin/python docs/demo/final-polish/verify_report.py BASE RUN_ID OUTPUT
This is HTTP content verification, not proof of a browser download.
"""
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import urllib.request

base, ident, target = sys.argv[1:4]
out = Path(target)
out.mkdir(parents=True, exist_ok=True)


def read(suffix):
    with urllib.request.urlopen(f"{base}/api/portfolio-command/runs/{ident}{suffix}") as response:
        assert response.status == 200
        assert response.headers["X-Concord-Delivery-Mode"] == "artifact-replay"
        return response.read()


saved = read("")
raw = read("/report/json")
page = read("/report/html")
result = json.loads(saved)
assert result == json.loads(raw)
embedded = json.loads(html.unescape(re.search(r"<pre>(.*?)</pre>", page.decode(), re.S)[1]))
assert embedded == result
copy = dict(result)
digest = copy.pop("result_sha256")
assert copy.pop("run_id") == ident == digest[:32]
canonical = json.dumps(copy, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
assert hashlib.sha256(canonical).hexdigest() == digest
assert result["execution_mode"] == "live_computation_synthetic_operations_registry_context"
for name, content in {"evidence.json": raw, "evidence.html": page}.items():
    (out / name).write_bytes(content)
receipt = {"run_id": ident, "result_sha256": digest, "source_commit": result["evidence"]["commit"],
    "source_dirty": result["evidence"]["dirty"], "saved_json_equals_export": True,
    "html_embedded_json_equals_export": True, "canonical_digest_valid": True,
    "delivery": "artifact-replay of the actual saved computation; not a browser-download assertion",
    "file_sha256": {n: hashlib.sha256((out / n).read_bytes()).hexdigest() for n in ("evidence.json", "evidence.html")},
    "request": {k: result["request"][k] for k in ("budget", "seed", "draws", "spread", "savings_realized")},
    "scenarios": [{"id": s["id"], "expected_makespan": s["expected_makespan"],
        "expected_commitment": s["ledger"]["expected_commitment"], "search_status": s["optimization"]["status"]} for s in result["scenarios"]]}
(out / "report-verification.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
