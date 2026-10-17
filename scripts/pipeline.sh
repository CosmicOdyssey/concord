#!/usr/bin/env bash
# Crawl CT.gov -> normalize -> build model -> congestion test -> CMS rate card -> robustness grid.
# Re-runnable; the crawl resumes from its checkpoint.
set -euo pipefail
cd "$(dirname "$0")/../backend"
mkdir -p ../data/raw/cms ../data/logs
PY=${PY:-.venv/Scripts/python}
[ -x "$PY" ] || PY=.venv/bin/python
NAME=${NAME:-nsclc}
COND=${COND:-"non-small cell lung cancer"}
RVU_URL=${RVU_URL:-https://www.cms.gov/files/zip/rvu26d-updated-08-26-2026.zip}

"$PY" -m concord.ingest.ctgov --name "$NAME" --cond "$COND"
"$PY" -m concord.ingest.normalize --name "$NAME"
"$PY" -m concord.model.build
"$PY" -m concord.analysis.congestion > ../data/logs/congestion.json

# CMS physician fee schedule (public). The lab fee schedule (CLFS) sits behind an AMA CPT license
# click-through; download 26clabq4.zip yourself after accepting it and set CLFS_ZIP to include it.
[ -f ../data/raw/cms/rvu.zip ] || curl -sSL -A "Mozilla/5.0" -o ../data/raw/cms/rvu.zip "$RVU_URL"
"$PY" -m concord.ratecard.cms --rvu ../data/raw/cms/rvu.zip ${CLFS_ZIP:+--clfs "$CLFS_ZIP"}

"$PY" -m concord.analysis.robustness --region US-Northeast
"$PY" -m concord.analysis.robustness --region US --sponsor Regeneron --as-of 2024-09-01
