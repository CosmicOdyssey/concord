#!/usr/bin/env bash
# Crawl CT.gov -> normalize -> build model. Re-runnable; the crawl resumes from its checkpoint.
set -euo pipefail
cd "$(dirname "$0")/../backend"
PY=${PY:-.venv/Scripts/python}
[ -x "$PY" ] || PY=.venv/bin/python
NAME=${NAME:-nsclc}
COND=${COND:-"non-small cell lung cancer"}
"$PY" -m concord.ingest.ctgov --name "$NAME" --cond "$COND"
"$PY" -m concord.ingest.normalize --name "$NAME"
"$PY" -m concord.model.build
