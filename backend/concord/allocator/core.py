"""Clearing problem (master doc §4.2–4.6).

Site s has patient flow lam[s] (reference-eligibility patients/month), activation
lag a[s] and concurrent-trial capacity k[s]. Trial P has relative eligible
fraction f[P], target N[P], max sites n_max[P], weight w[P]. o[P, Q] is the
overlap Pr[e_Q | e_P] with o[P, P] ignored.

    rate[s, P] = lam[s] f[P] / (1 + sum_{Q != P} x[s, Q] o[P, Q])^beta   (2')
    T_P(x)     = mean_{s: x[s,P]} a[s] + N[P] / sum_s x[s, P] rate[s, P]  (3)
    min_x sum_P w[P] T_P(x)  s.t. feasibility, k, n_max                   (4)-(6)
                             and T_P(x) <= caps[P]   (optional no-loser constraint)

beta is the congestion elasticity. The master doc's eq. (2) is beta = 1; the data
(concord.analysis.congestion, within-site) says about 0.14, so the service sets beta
from that estimate. Trials with movable[P] = False are background: their sites are held
fixed but their congestion still counts.

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
    beta: float = 1.0
    movable: np.ndarray | None = None  # (P,) bool; None = all trials movable
    caps: np.ndarray | None = None  # (P,) max allowed T; None = unconstrained

    def __post_init__(self) -> None:
        self.o = np.array(self.o, dtype=float)
        np.fill_diagonal(self.o, 0.0)
        self.base = np.outer(self.lam, self.f)  # (S, P) uncongested rate
        if self.movable is None:
            self.movable = np.ones(len(self.f), dtype=bool)
        if self.caps is None:
            self.caps = np.full(len(self.f), np.inf)
        finite = np.where(np.isfinite(self.caps), np.abs(self.caps), 0.0)
        self.slack = self.caps + 1e-9 * (1.0 + finite)

    def g(self, load):
        """Congestion multiplier on the uncongested rate."""
        return (1.0 + load) ** (-self.beta)

    def replace(self, **kw) -> "Instance":
        fields = dict(lam=self.lam, a=self.a, k=self.k, f=self.f, N=self.N, n_max=self.n_max, w=self.w, o=self.o,
                      feasible=self.feasible, site_ids=self.site_ids, trial_ids=self.trial_ids, beta=self.beta,
                      movable=self.movable, caps=self.caps)
        fields.update(kw)
        return Instance(**fields)

    @property
    def S(self) -> int:
        return len(self.lam)

    @property
    def P(self) -> int:
        return len(self.f)


class Budget:
    """Deterministic work budget for the solver: counts objective evaluations (delta_toggle calls;
    an exchange attempt counts 4). The search stops when the count reaches `evals`, so the result
    depends only on the instance, the seed and the budget, not on CPU load. A wall-clock cap is kept
    only as a safety net; if it is ever hit, the solve is reported as non-deterministic."""

    def __init__(self, evals: int | None = None, seconds: float = 600.0):
        self.limit = evals
        self.n = 0
        self.t0 = time.monotonic()
        self.deadline = self.t0 + seconds
        self.hit_time = False

    def spend(self, k: int = 1) -> None:
        self.n += k

    def done(self) -> bool:
        if self.limit is not None and self.n >= self.limit:
            return True
        if time.monotonic() >= self.deadline:
            self.hit_time = True
            return True
        return False


class State:
    """Assignment x with incrementally maintained loads, rates and T."""

    def __init__(self, inst: Instance, x: np.ndarray | None = None, budget: Budget | None = None):
        self.inst = inst
        self.budget = budget
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
        return self.inst.base * self.inst.g(self.load)

    def _T(self, R: np.ndarray, asum: np.ndarray, cnt: np.ndarray, N: np.ndarray) -> np.ndarray:
        with np.errstate(divide="ignore", invalid="ignore"):
            t = asum / np.maximum(cnt, 1) + N / R
        return np.where(cnt > 0, np.minimum(t, NO_SITES_T), NO_SITES_T)

    def _T_all(self) -> np.ndarray:
        return self._T(self.R, self.asum, self.cnt, self.inst.N)

    def objective(self) -> float:
        return float(self.inst.w @ self.T)

    def delta_toggle(self, s: int, p: int, check_caps: bool = True) -> float:
        """Objective change if x[s, p] were flipped, without mutating state. With check_caps,
        +inf if afterwards p is above its cap or another trial is pushed further above its cap
        (no-loser constraint). Compound moves check only their final step."""
        if self.budget is not None:
            self.budget.spend()
        inst, sign = self.inst, (-1.0 if self.x[s, p] else 1.0)
        others = np.flatnonzero(self.x[s])
        others = others[others != p]
        d = 0.0
        if len(others):
            old_load = self.load[s, others]
            new_load = old_load + sign * inst.o[others, p]
            dR = inst.base[s, others] * (inst.g(new_load) - inst.g(old_load))
            T_new = self._T(self.R[others] + dR, self.asum[others], self.cnt[others], inst.N[others])
            if check_caps and ((T_new > inst.slack[others]) & (T_new > self.T[others])).any():
                return np.inf
            d += float(inst.w[others] @ (T_new - self.T[others]))
        r = inst.base[s, p] * inst.g(self.load[s, p])
        T_p = self._T(np.array([self.R[p] + sign * r]), np.array([self.asum[p] + sign * inst.a[s]]),
                      np.array([self.cnt[p] + int(sign)]), inst.N[p:p + 1])[0]
        if check_caps and T_p > inst.slack[p]:
            return np.inf
        return d + float(inst.w[p] * (T_p - self.T[p]))

    def feasible_caps(self) -> bool:
        return bool((self.T <= self.inst.slack).all())

    def toggle(self, s: int, p: int) -> None:
        inst, sign = self.inst, (-1.0 if self.x[s, p] else 1.0)
        rate_before = inst.base[s] * inst.g(self.load[s])
        on_site = self.x[s].copy()
        on_site[p] = False
        self.load[s] += sign * inst.o[:, p]
        rate_after = inst.base[s] * inst.g(self.load[s])
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
        return bool(i.movable[p] and not self.x[s, p] and i.feasible[s, p] and self.site_cnt[s] < i.k[s]
                    and self.cnt[p] < i.n_max[p])


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


def independent(inst: Instance, order: list[int] | None = None, respect_capacity: bool = True,
                background: np.ndarray | None = None) -> np.ndarray:
    """Status quo (§4.4): each trial takes its top n_max feasible sites by lam*f, ignoring
    everyone else. With respect_capacity, trials claim sites first-come in `order` and a
    full site is skipped, which is a conservative (generous-to-status-quo) baseline.
    Non-movable trials keep their columns from `background`."""
    x = np.zeros((inst.S, inst.P), dtype=bool)
    if background is not None:
        x[:, ~inst.movable] = background[:, ~inst.movable]
    used = x.sum(axis=1)
    for p in order if order is not None else range(inst.P):
        if not inst.movable[p]:
            continue
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


def _greedy(st: State, cands: list[np.ndarray], K: int, budget: Budget) -> None:
    """Worst-off trial takes the site with the best marginal objective gain, until no gain."""
    inst = st.inst
    while not budget.done():
        best = (0.0, -1, -1)
        for p in np.argsort(-(inst.w * st.T)):
            if st.cnt[p] >= inst.n_max[p] or not inst.movable[p]:
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


def _local_search(st: State, cands: list[np.ndarray], K: int, budget: Budget, rng,
                  max_passes: int | None = None) -> tuple[int, int]:
    """First-improvement moves: drop a site that only adds congestion, or move it elsewhere."""
    inst, moves, improved, passes = st.inst, 0, 0, 0
    while not budget.done() and (max_passes is None or passes < max_passes):
        passes += 1
        improved_pass = False
        for p in rng.permutation(np.flatnonzero(inst.movable)):
            for s in np.flatnonzero(st.x[:, p]):
                d_drop = st.delta_toggle(s, p)
                if d_drop < -1e-9 and st.cnt[p] > 1:
                    st.toggle(s, p); improved += 1; improved_pass = True
                    continue
                # Swap: the drop alone may break p's cap; only the state after the add must hold.
                d_raw = d_drop if np.isfinite(d_drop) else st.delta_toggle(s, p, check_caps=False)
                st.toggle(s, p)
                best_d, best_s = d_drop, -1
                for s2 in _open(st, cands[p], p, K, skip=s):
                    moves += 1
                    d = d_raw + st.delta_toggle(s2, p)
                    if d < best_d - 1e-9 and d < -1e-9:
                        best_d, best_s = d, s2
                st.toggle(best_s if best_s >= 0 else s, p)
                if best_s >= 0:
                    improved += 1; improved_pass = True
            if budget.done():
                break
        if not improved_pass:
            break
    return moves, improved


def _exchange(st: State, budget: Budget, partners: int = 12) -> tuple[int, int]:
    """Two trials trade sites (p: s -> s2, q: s2 -> s). Single-trial moves cannot find these
    when every trial sits at its no-loser cap, since each half alone makes someone worse off.
    Partners are the trials p overlaps most with (where relief from congestion is largest)."""
    inst, tries, done = st.inst, 0, 0
    mv = np.flatnonzero(inst.movable)
    for p in mv:
        qs = [q for q in np.argsort(-inst.o[p]) if inst.movable[q] and q != p][:partners]
        for s in np.flatnonzero(st.x[:, p]):
            for q in qs:
                if st.x[s, q] or not inst.feasible[s, q]:
                    continue
                for s2 in np.flatnonzero(st.x[:, q] & ~st.x[:, p] & inst.feasible[:, p]):
                    if not st.x[s, p] or st.x[s, q]:
                        break  # an earlier exchange already moved p or q
                    tries += 1
                    budget.spend(4)
                    before = st.objective()
                    steps = [(s, p), (s2, q), (s2, p), (s, q)]
                    for a, b in steps:
                        st.toggle(a, b)
                    if st.feasible_caps() and st.objective() < before - 1e-9:
                        done += 1
                        break
                    for a, b in reversed(steps):
                        st.toggle(a, b)
            if budget.done():
                return tries, done
    return tries, done


def coordinate(inst: Instance, x0: np.ndarray | None = None, K: int = 60, eval_budget: int | None = None,
               time_limit: float = 600.0, seed: int = 0, patience: int = 40, kick: float = 0.2,
               max_passes: int | None = None) -> tuple[np.ndarray, dict]:
    """Greedy + local search + pairwise exchanges, then iterated local search: knock out a random
    `kick` share of assignments, repair greedily, re-run local search, keep the result if it is
    better. Stops after `patience` kicks without improvement or when `eval_budget` objective
    evaluations are spent (see Budget), so the result is deterministic for a given seed and budget.
    `time_limit` is only a safety cap; "deterministic" in the stats says whether it was hit."""
    budget = Budget(eval_budget, time_limit)
    rng = np.random.default_rng(seed)
    cands = candidate_lists(inst)
    st = State(inst, x0, budget)
    if not st.feasible_caps():
        raise ValueError("start allocation violates caps; start from the baseline the caps came from")
    _greedy(st, cands, K, budget)
    greedy_obj = st.objective()
    moves, improved = _local_search(st, cands, K, budget, rng, max_passes)
    ex_tries, ex_done = (0, 0) if max_passes is not None else _exchange(st, budget)
    if ex_done:
        m, i = _local_search(st, cands, K, budget, rng, max_passes)
        moves += m; improved += i
    best_x, best_obj = st.x.copy(), st.objective()

    kicks = stale = 0
    while not budget.done() and stale < patience:
        trial = State(inst, best_x, budget)
        on = np.argwhere(trial.x & inst.movable[None, :])
        if not len(on):
            break
        n_out = max(1, int(round(kick * len(on))))
        for s, p in on[rng.choice(len(on), size=min(n_out, len(on)), replace=False)]:
            trial.toggle(s, p)
        # Force one random addition so greedy does not simply rebuild the same state.
        p = int(rng.choice(np.flatnonzero(inst.movable)))
        opts = [s for s in _open(trial, cands[p], p, K)]
        if opts:
            trial.toggle(int(rng.choice(opts)), p)
        _greedy(trial, cands, K, budget)
        m, i = _local_search(trial, cands, K, budget, rng)
        moves += m; kicks += 1
        if trial.objective() < best_obj - 1e-9 and trial.feasible_caps():
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
        "exchanges_tried": ex_tries,
        "exchanges_made": ex_done,
        "evals": budget.n,
        "eval_budget": eval_budget,
        "hit_eval_budget": eval_budget is not None and budget.n >= eval_budget,
        "seconds": round(time.monotonic() - budget.t0, 3),
        "hit_time_limit": budget.hit_time,
        "deterministic": not budget.hit_time,
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
        T = evaluate(inst, x)
        if (T > inst.slack).any():
            continue
        obj = float(inst.w @ T)
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
