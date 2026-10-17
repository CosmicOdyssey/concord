import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# CONCORD_DATA_DIR lets a git worktree (which has no data/) point at a private copy of the data.
DATA_DIR = Path(os.environ.get("CONCORD_DATA_DIR", ROOT / "data"))
RAW_DIR = Path(os.environ.get("CONCORD_RAW_DIR", DATA_DIR / "raw" / "ctgov"))
DB_PATH = DATA_DIR / "concord.db"
# Curated findings shipped with the repo (findings page); independent of CONCORD_DATA_DIR.
FINDINGS_DIR = ROOT / "data" / "findings"
