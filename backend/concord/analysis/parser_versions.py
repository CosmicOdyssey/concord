"""Historical eligibility parsers, loaded from git, for the parser-sensitivity line (item 3).

Method: pre-registered in concord.analysis.congestion (V2, section D). Each version's
backend/concord/compiler/eligibility.py and population.py are read with `git show <commit>:<path>`
into a temporary directory and imported as standalone modules under private names. Nothing is
written into the repo or the concord package, and the current concord.compiler modules are never
replaced. Every version compiles every lung trial's eligibility_text with its own extract_criteria and
eligible_mask on its own synthetic population (n = 4000, seed = 11, as congestion._masks).
"""

from __future__ import annotations

import importlib.util
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from types import ModuleType

import numpy as np

from concord.paths import ROOT

N_POP, SEED = 4000, 11  # exactly as congestion._masks
FILES = ("eligibility", "population")
REPO_DIR = "backend/concord/compiler"

# Oldest to newest.
VERSIONS: list[dict] = [
    {"parser_version": "v0", "commit": "b8c576f",
     "description": "header match is startswith('exclusion criteria'), so 'Key Exclusion Criteria' sections "
                    "are read as inclusion; no driver-exclusion, never-smoker or resectable rules; "
                    "population has stage III/IV only"},
    {"parser_version": "v1", "commit": "c0050f4",
     "description": "headers fixed; driver-exclusion, never-smoker and resectable rules added; a required "
                    "driver also fired the broad driver exclusion, so many trials had contradictory criteria "
                    "and an empty eligibility set"},
    {"parser_version": "v2", "commit": "4a87d33",
     "description": "current: a required driver suppresses the driver exclusion and resectable overrides "
                    "stage III-IV (contradictory criteria removed)"},
]


def _git_show(commit: str, path: str) -> str:
    out = subprocess.run(["git", "-C", str(ROOT), "show", f"{commit}:{path}"], capture_output=True, check=True)
    return out.stdout.decode("utf-8")


def load_version(commit: str) -> dict[str, ModuleType]:
    """{'eligibility': module, 'population': module} as of `commit`, imported from a temp dir."""
    mods: dict[str, ModuleType] = {}
    with tempfile.TemporaryDirectory(prefix=f"concord_parser_{commit}_") as tmp:
        for name in FILES:
            src = _git_show(commit, f"{REPO_DIR}/{name}.py")
            # Standalone only: an import of the live package would silently mix versions.
            if re.search(r"^\s*(from|import)\s+concord\b", src, re.M):
                raise RuntimeError(f"{commit}:{name}.py imports the concord package")
            path = Path(tmp) / f"{name}.py"
            path.write_text(src, encoding="utf-8")
            modname = f"_concord_parser_{commit}_{name}"
            spec = importlib.util.spec_from_file_location(modname, path)
            mod = importlib.util.module_from_spec(spec)
            sys.modules[modname] = mod  # dataclasses resolve annotations through sys.modules
            spec.loader.exec_module(mod)
            mods[name] = mod
    return mods


def source_matches_working_tree(commit: str) -> bool:
    """Whether the version's two files equal the files in this checkout."""
    for name in FILES:
        here = (ROOT / REPO_DIR / f"{name}.py").read_text(encoding="utf-8")
        if _git_show(commit, f"{REPO_DIR}/{name}.py").replace("\r\n", "\n") != here.replace("\r\n", "\n"):
            return False
    return True


def compile_masks(con: sqlite3.Connection, mods: dict[str, ModuleType],
                  overrides: dict | None = None) -> dict[str, np.ndarray]:
    """Eligibility mask of every lung trial under one parser version (overrides: none unless given)."""
    elig = mods["eligibility"]
    pop = mods["population"].synthetic_population(N_POP, seed=SEED)
    out: dict[str, np.ndarray] = {}
    for nct, text in con.execute("SELECT nct_id, eligibility_text FROM trials WHERE is_lung=1"):
        crit = (overrides or {}).get(nct) or elig.extract_criteria(text or "")
        out[nct] = elig.eligible_mask(crit, pop)
    return out
