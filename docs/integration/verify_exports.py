"""Verify API export content for a browser-observed run; never a download test.

Usage: backend/.venv/bin/python docs/integration/verify_exports.py BASE_URL RUN_ID
"""
import hashlib
import html
import json
from pathlib import Path
import re
import sys
import urllib.request

base, ident = sys.argv[1:3]
out = Path(__file__).parent
url = f"{base}/api/portfolio-command/runs/{ident}"


def read(address):
    with urllib.request.urlopen(address) as response:
        return response.read(), {k.lower(): v for k, v in response.headers.items()}


body, headers = read(url)
json_body, json_headers = read(url + "/report/json")
page, html_headers = read(url + "/report/html")
result = json.loads(body)
assert json.loads(json_body) == result
embedded = json.loads(html.unescape(re.search(r"<pre>(.*?)</pre>", page.decode(), re.S)[1]))
assert embedded == result
copy = dict(result)
digest = copy.pop("result_sha256")
assert copy.pop("run_id") == digest[:32] == ident
canonical = json.dumps(copy, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
assert hashlib.sha256(canonical).hexdigest() == digest
for h in (headers, json_headers, html_headers):
    assert h["x-concord-delivery-mode"] == "artifact-replay"
assert result["execution_mode"] == "live_computation_synthetic_operations_registry_context"
# Exact values observed in browser-scenarios.txt, not inferred from API success.
assert [s["expected_makespan"] for s in result["scenarios"]] == [15.13, 15.13, 9.22, 15.13, 9.22, 8.85]
assert [round(s["ledger"]["expected_commitment"]) for s in result["scenarios"]] == [1018305, 943305, 1105508, 967305, 1180508, 1152502]
request = urllib.request.Request(base + "/api/portfolio-command/compare",
    data=json.dumps(result["request"]).encode(), headers={"Content-Type": "application/json"})
with urllib.request.urlopen(request) as response:
    repeated = json.load(response)
assert repeated["scenarios"] == result["scenarios"]
# Git provenance is part of the content address. Synchronizing an unrelated
# main commit must produce new evidence identity, even with identical numbers.
def without_git_identity(value):
    value = json.loads(json.dumps(value))
    for key in ("run_id", "result_sha256", "input_sha256"):
        value.pop(key)
    for key in ("commit", "dirty"):
        value["evidence"].pop(key)
    return value

assert without_git_identity(repeated) == without_git_identity(result)
files = {"browser-run-api.json": body, "report-endpoint.json": json_body, "report-endpoint.html": page}
for name, data in files.items():
    (out / name).write_bytes(data)
evidence = {"browser_run": ident, "result_sha256": digest, "json_equals_saved_api": True,
    "html_embedded_json_equals_saved_api": True, "canonical_digest_valid": True,
    "repeat_scenarios_identical": True, "repeat_identical_except_git_identity": True,
    "original_commit": result["evidence"]["commit"], "repeated_commit": repeated["evidence"]["commit"],
    "repeated_run_id": repeated["run_id"], "browser_values_match": True,
    "delivery_mode": "artifact-replay", "origin_mode": result["execution_mode"],
    "export_bytes_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
    "browser_download": "NOT VERIFIED: both links clicked; no matching file appeared in Downloads; earlier acceptance recorded organizational blocking. No policy bypass attempted."}
(out / "export-verification.json").write_text(json.dumps(evidence, indent=2) + "\n")
print(json.dumps(evidence, indent=2))
