"""Clearing problem (master doc §4.2–4.6).

Site s has patient flow lam[s] (reference-eligibility patients/month), activation
lag a[s] and concurrent-trial capacity k[s]. Trial P has relative eligible
fraction f[P], target N[P], max sites n_max[P], weight w[P]. o[P, Q] is the
overlap Pr[e_Q | e_P] with o[P, P] ignored.

    rate[s, P] = lam[s] f[P] / (1 + sum_{Q != P} x[s, Q] o[P, Q])        (2)
    T_P(x)     = mean_{s: x[s,P]} a[s] + N[P] / sum_s x[s, P] rate[s, P]  (3)
    min_x sum_P w[P] T_P(x)  s.t. feasibility, k, n_max                   (4)-(6)

The solver is greedy by marginal gain plus swap local search (§4.6), with all
deltas computed incrementally: toggling (s, P) only changes rates at site s.
"""

from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field

import numpy as np

NO_SITES_T = 1e4  # months; stands in for "never fills" so greedy gains stay finite


@dataclass
class Instance:
    lam: np.ndarray  # (S,)
    a: np.ndarray  # (S,)
    k: np.ndarray  # (S,) int
    f: np.ndarray  # (P,)
    N: np.ndarray  # (P,)
    n_max: np.ndarray  # (P,) int
    w: np.ndarray  # (P,)
    o: np.ndarray  # (P, P)
    feasible: np.ndarray  # (S, P) bool: capability + quality screen
    site_ids: list[str] = field(default_factory=list)
    trial_ids: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.o = np.array(self.o, dtype=float)
        np.fill_diagonal(self.o, 0.0)
        self.base = np.outer(self.lam, self.f)  # (S, P) uncongested rate

    @property
    def S(self) -> int:
        return len(self.lam)

    @property
    def P(self) -> int:
        return len(self.f)


class State:
    """Assignment x with incrementally maintained loads, rates and T."""

    def __init__(self, inst: Instance, x: np.ndarray | None = None):
        self.inst = inst
        self.x = np.zeros((inst.S, inst.P), dtype=bool)
        self.load = np.zeros((inst.S, inst.P))
        self.R = np.zeros(inst.P)
        self.asum = np.zeros(inst.P)
        self.cnt = np.zeros(inst.P, dtype=int)
        self.site_cnt = np.zeros(inst.S, dtype=int)
        if x is not None:
            self.x = x.astype(bool).copy()
            self.load = self.x.astype(float) @ inst.o.T  # load[s,P] = sum_Q x[s,Q] o[P,Q]
            self.R = (self.x * self.rate_matrix()).sum(axis=0)
            self.asum = self.x.T.astype(float) @ inst.a
            self.cnt = self.x.sum(axis=0)
            self.site_cnt = self.x.sum(axis=1)
        self.T = self._T_all()

    def rate_matrix(self) -> np.ndarray:
        return self.inst.base / (1.0 + self.load)

    def _T(self, R: np.ndarray, asum: np.ndarray, cnt: np.ndarray, N: np.ndarray) -> np.ndarray:
        with np.errstate(divide="ignore", invalid="ignore"):
            t = asum / np.maximum(cnt, 1) + N / R
        return np.where(cnt > 0, np.minimum(t, NO_SITES_T), NO_SITES_T)

    def _T_all(self) -> np.ndarray:
        return self._T(self.R, self.asum, self.cnt, self.inst.N)

    def objective(self) -> float:
        return float(self.inst.w @ self.T)

    def delta_toggle(self, s: int, p: int) -> float:
        """Objective change if x[s, p] were flipped, without mutating state."""
        inst, sign = self.inst, (-1.0 if self.x[s, p] else 1.0)
        others = np.flatnonzero(self.x[s])
        others = others[others != p]
        d = 0.0
        if len(others):
            old_load = self.load[s, others]
            new_load = old_load + sign * inst.o[others, p]
            dR = inst.base[s, others] * (1.0 / (1.0 + new_load) - 1.0 / (1.0 + old_load))
            T_new = self._T(self.R[others] + dR, self.asum[others], self.cnt[others], inst.N[others])
            d += float(inst.w[others] @ (T_new - self.T[others]))
        r = inst.base[s, p] / (1.0 + self.load[s, p])
        T_p = self._T(np.array([self.R[p] + sign * r]), np.array([self.asum[p] + sign * inst.a[s]]),
                      np.array([self.cnt[p] + int(sign)]), inst.N[p:p + 1])[0]
        return d + float(inst.w[p] * (T_p - self.T[p]))

    def toggle(self, s: int, p: int) -> None:
        inst, sign = self.inst, (-1.0 if self.x[s, p] else 1.0)
        rate_before = inst.base[s] / (1.0 + self.load[s])
        on_site = self.x[s].copy()
        on_site[p] = False
        self.load[s] += sign * inst.o[:, p]
        rate_after = inst.base[s] / (1.0 + self.load[s])
        self.R[on_site] += rate_after[on_site] - rate_before[on_site]
        self.R[p] += sign * rate_before[p]  # p's own load is unaffected by its own toggle
        self.asum[p] += sign * inst.a[s]
        self.cnt[p] += int(sign)
        self.site_cnt[s] += int(sign)
        self.x[s, p] = not self.x[s, p]
        if self.cnt[p] == 0:
            self.R[p] = 0.0
        touched = on_site.copy()
        touched[p] = True
        self.T[touched] = self._T(self.R[touched], self.asum[touched], self.cnt[touched], inst.N[touched])

    def can_add(self, s: int, p: int) -> bool:
        i = self.inst
        return (not self.x[s, p]) and i.feasible[s, p] and self.site_cnt[s] < i.k[s] and self.cnt[p] < i.n_max[p]


def evaluate(inst: Instance, x: np.ndarray) -> np.ndarray:
    """T_P for every trial under assignment x."""
    return State(inst, x).T


def candidate_lists(inst: Instance) -> list[np.ndarray]:
    """Feasible sites per trial, best uncongested rate first."""
    out = []
    for p in range(inst.P):
        feas = np.flatnonzero(inst.feasible[:, p])
        out.append(feas[np.argsort(-inst.base[feas, p])])
    return out


def _open(st: "State", cands: np.ndarray, p: int, K: int, skip: int = -1):
    """First K candidate sites for p that can still take it. Rankings are nearly the same for
    every trial (lam dominates), so a fixed top-K list fills up and stalls the search."""
    n = 0
    for s in cands:
        if s != skip and st.can_add(s, p):
            yield s
            n += 1
            if n >= K:
                return


def independent(inst: Instance, order: list[int] | None = None, respect_capacity: bool = True) -> np.ndarray:
    """Status quo (§4.4): each trial takes its top n_max feasible sites by lam*f, ignoring
    everyone else. With respect_capacity, trials claim sites first-come in `order` and a
    full site is skipped, which is a conservative (generous-to-status-quo) baseline."""
    x = np.zeros((inst.S, inst.P), dtype=bool)
    used = np.zeros(inst.S, dtype=int)
    for p in order if order is not None else range(inst.P):
        feas = np.flatnonzero(inst.feasible[:, p])
        taken = 0
        for s in feas[np.argsort(-inst.base[feas, p])]:
            if taken >= inst.n_max[p]:
                break
            if respect_capacity and used[s] >= inst.k[s]:
                continue
            x[s, p] = True
            used[s] += 1
            taken += 1
    return x


def _greedy(st: State, cands: list[np.ndarray], K: int, deadline: float) -> None:
    """Worst-off trial takes the site with the best marginal objective gain, until no gain."""
    inst = st.inst
    while time.monotonic() < deadline:
        best = (0.0, -1, -1)
        for p in np.argsort(-(inst.w * st.T)):
            if st.cnt[p] >= inst.n_max[p]:
                continue
            for s in _open(st, cands[p], p, K):
                d = st.delta_toggle(s, p)
                if d < best[0] - 1e-12:
                    best = (d, s, p)
            if best[1] >= 0:
                break  # commit the worst-off trial's best move before scanning the rest
        if best[1] < 0:
            return
        st.toggle(best[1], best[2])


def _local_search(st: State, cands: list[np.ndarray], K: int, deadline: float, rng,
                  max_passes: int | None = None) -> tuple[int, int]:
    """First-improvement moves: drop a site that only adds congestion, or move it elsewhere."""
    inst, moves, improved, passes = st.inst, 0, 0, 0
    while time.monotonic() < deadline and (max_passes is None or passes < max_passes):
        passes += 1
        improved_pass = False
        for p in rng.permutation(inst.P):
            for s in np.flatnonzero(st.x[:, p]):
                d_drop = st.delta_toggle(s, p)
                if d_drop < -1e-9 and st.cnt[p] > 1:
                    st.toggle(s, p); improved += 1; improved_pass = True
                    continue
                st.toggle(s, p)
                best_d, best_s = d_drop, -1
                for s2 in _open(st, cands[p], p, K, skip=s):
                    moves += 1
                    d = d_drop + st.delta_toggle(s2, p)
                    if d < best_d - 1e-9 and d < -1e-9:
                        best_d, best_s = d, s2
                st.toggle(best_s if best_s >= 0 else s, p)
                if best_s >= 0:
                    improved += 1; improved_pass = True
            if time.monotonic() >= deadline:
                break
        if not improved_pass:
            break
    return moves, improved


def coordinate(inst: Instance, x0: np.ndarray | None = None, K: int = 60, time_limit: float = 10.0,
               seed: int = 0, patience: int = 40, kick: float = 0.2,
               max_passes: int | None = None) -> tuple[np.ndarray, dict]:
    """Greedy + local search, then iterated local search: knock out a random `kick` share of
    assignments, repair greedily, re-run local search, keep the result if it is better.
    Stops at `time_limit` or after `patience` kicks without improvement. For counterfactual
    comparisons pass max_passes and patience=0 so the result does not depend on wall-clock time."""
    t0 = time.monotonic()
    deadline = t0 + time_limit
    rng = np.random.default_rng(seed)
    cands = candidate_lists(inst)
    st = State(inst, x0)
    _greedy(st, cands, K, deadline)
    greedy_obj = st.objective()
    moves, improved = _local_search(st, cands, K, deadline, rng, max_passes)
    best_x, best_obj = st.x.copy(), st.objective()

    kicks = stale = 0
    while time.monotonic() < deadline and stale < patience:
        trial = State(inst, best_x)
        on = np.argwhere(trial.x)
        n_out = max(1, int(round(kick * len(on))))
        for s, p in on[rng.choice(len(on), size=min(n_out, len(on)), replace=False)]:
            trial.toggle(s, p)
        # Force one random addition so greedy does not simply rebuild the same state.
        p = int(rng.integers(inst.P))
        opts = [s for s in _open(trial, cands[p], p, K)]
        if opts:
            trial.toggle(int(rng.choice(opts)), p)
        _greedy(trial, cands, K, deadline)
        m, i = _local_search(trial, cands, K, deadline, rng)
        moves += m; kicks += 1
        if trial.objective() < best_obj - 1e-9:
            best_x, best_obj, stale = trial.x.copy(), trial.objective(), 0
            improved += i + 1
        else:
            stale += 1
    return best_x, {
        "greedy_objective": greedy_obj,
        "objective": best_obj,
        "moves_evaluated": moves,
        "improvements": improved,
        "kicks": kicks,
        "seconds": round(time.monotonic() - t0, 3),
        "hit_time_limit": time.monotonic() >= deadline,
    }


def exhaustive(inst: Instance) -> tuple[np.ndarray, float]:
    """Brute-force optimum for tiny fixtures (S*P <= ~16)."""
    cells = [(s, p) for s in range(inst.S) for p in range(inst.P) if inst.feasible[s, p]]
    best_x, best = None, np.inf
    for bits in itertools.product([0, 1], repeat=len(cells)):
        x = np.zeros((inst.S, inst.P), dtype=bool)
        for (s, p), b in zip(cells, bits):
            x[s, p] = bool(b)
        if (x.sum(axis=1) > inst.k).any() or (x.sum(axis=0) > inst.n_max).any():
            continue
        obj = float(inst.w @ evaluate(inst, x))
        if obj < best:
            best, best_x = obj, x
    return best_x, best


def summarize(inst: Instance, x_indep: np.ndarray, x_coord: np.ndarray) -> dict:
    T_i, T_c = evaluate(inst, x_indep), evaluate(inst, x_coord)
    filled = (T_i < NO_SITES_T) & (T_c < NO_SITES_T)
    num, den = float(inst.w[filled] @ T_i[filled]), float(inst.w[filled] @ T_c[filled])
    return {
        "poa": num / den if den > 0 else None,
        "dividend_trial_months": num - den,
        "objective_indep": num,
        "objective_coord": den,
        "trials_unfillable_indep": int((T_i >= NO_SITES_T).sum()),
        "trials_unfillable_coord": int((T_c >= NO_SITES_T).sum()),
    }
