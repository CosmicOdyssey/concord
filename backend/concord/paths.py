from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw" / "ctgov"
DB_PATH = DATA_DIR / "concord.db"
