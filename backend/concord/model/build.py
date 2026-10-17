"""Build model tables from the normalized CT.gov DB.

    python -m concord.model.build

Writes:
  trial_model(nct_id, f, f_rel, criteria)      eligibility compiled on the synthetic population
  site_model(site_id, lam, shape, rate, n_hist, k_hist, ...)   Poisson–gamma posteriors + capacity
                                                (lam = posterior median, patients/month per trial)
  meta(key, value)                              prior, assumptions, backtest
"""

from __future__ import annotations

import json
import sqlite3
import time

import numpy as np

from concord.compiler.eligibility import eligible_fraction, extract_criteria
from concord.compiler.overrides import OVERRIDES
from concord.compiler.population import synthetic_population
from concord.model import recruitment
from concord.paths import DB_PATH

INSTANCE_LIKE = """t.sponsor_class='INDUSTRY' AND (t.phases LIKE '%PHASE2%' OR t.phases LIKE '%PHASE3%')"""


def compile_trials(con: sqlite3.Connection, pop: dict) -> dict[str, float]:
    rows = con.execute("SELECT nct_id, eligibility_text FROM trials WHERE is_lung=1").fetchall()
    out = []
    fs = {}
    for nct, text in rows:
        crit = OVERRIDES.get(nct) or extract_criteria(text or "")
        fs[nct] = eligible_fraction(crit, pop)
        out.append((nct, fs[nct], json.dumps([c.to_dict() for c in crit])))
    f_ref = float(np.median(list(fs.values())))
    con.execute("DROP TABLE IF EXISTS trial_model")
    con.execute("CREATE TABLE trial_model (nct_id TEXT PRIMARY KEY, f REAL, f_rel REAL, criteria TEXT)")
    con.executemany("INSERT INTO trial_model VALUES (?,?,?,?)", [(n, f, f / f_ref, c) for n, f, c in out])
    con.execute("INSERT OR REPLACE INTO meta VALUES ('f_ref', ?)", (json.dumps(f_ref),))
    return {n: f / f_ref for n, f in fs.items()}


def peak_concurrency(windows: list[tuple[str, str]]) -> int:
    events = sorted([(s, 1) for s, _ in windows] + [(e, -1) for _, e in windows], key=lambda x: (x[0], x[1]))
    cur = peak = 0
    for _, d in events:
        cur += d
        peak = max(peak, cur)
    return peak


def build(db_path=DB_PATH) -> dict:
    t0 = time.time()
    con = sqlite3.connect(db_path)
    con.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
    pop = synthetic_population(20_000)
    f_rel = compile_trials(con, pop)

    hist = recruitment.load_history(con)  # raw exposure; see recruitment.O_BAR
    rates = recruitment.fit(hist)
    lk = {s: (a, b, m) for s, a, b, m in zip(rates.site_ids, rates.shape, rates.rate, rates.median)}
    prior_median = float(recruitment.gamma_dist.ppf(0.5, rates.alpha, scale=1.0 / rates.beta))

    # Capacity: peak number of overlapping industry Phase II/III lung trials a site has run.
    win: dict[str, list] = {}
    n_hist: dict[str, int] = {}
    for sid, s, e in con.execute(f"""
            SELECT ts.site_id, t.start_date, COALESCE(t.primary_completion_date, t.completion_date)
            FROM trial_sites ts JOIN trials t USING(nct_id)
            WHERE t.is_lung=1 AND t.start_date IS NOT NULL AND {INSTANCE_LIKE}"""):
        n_hist[sid] = n_hist.get(sid, 0) + 1
        if e:
            win.setdefault(sid, []).append((s, e))
    all_hist = dict(con.execute(
        "SELECT site_id, COUNT(*) FROM trial_sites JOIN trials USING(nct_id) WHERE is_lung=1 GROUP BY site_id"))

    con.execute("DROP TABLE IF EXISTS site_model")
    con.execute("""CREATE TABLE site_model (site_id TEXT PRIMARY KEY, lam REAL, lam_mean REAL, lam_eff REAL,
                   shape REAL, rate REAL, n_hist INTEGER, n_hist_industry INTEGER, k_hist INTEGER, fitted INTEGER)""")
    hist_n = np.bincount([l[1] for l in hist.links], minlength=len(rates.site_ids))
    lam_eff, unseen = recruitment.effective_rates(rates, hist_n)
    eff = dict(zip(rates.site_ids, lam_eff))
    rows = []
    for sid in [r[0] for r in con.execute("SELECT site_id FROM sites")]:
        shape, rate, med = lk.get(sid, (rates.alpha, rates.beta, prior_median))
        rows.append((sid, float(med), shape / rate, float(eff.get(sid, unseen)), shape, rate, all_hist.get(sid, 0),
                     n_hist.get(sid, 0), max(1, peak_concurrency(win.get(sid, []))), int(sid in lk)))
    con.executemany("INSERT INTO site_model VALUES (?,?,?,?,?,?,?,?,?,?)", rows)

    bt = recruitment.backtest(con)
    meta = {
        "prior": {"alpha": rates.alpha, "beta": rates.beta, "mean": rates.alpha / rates.beta,
                  "median": prior_median},
        "history_trials": len(hist.N),
        "fitted_sites": len(rates.site_ids),
        "assumptions": {
            "enroll_fraction": recruitment.ENROLL_FRACTION,
            "o_bar": recruitment.O_BAR,
            "population": "synthetic; see concord/compiler/population.py",
        },
        "backtest": bt,
    }
    for k, v in meta.items():
        con.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (k, json.dumps(v)))
    con.commit()
    con.close()
    meta["seconds"] = round(time.time() - t0, 1)
    return meta


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
