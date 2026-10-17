# Concord frontend

Vite + React + TypeScript single-page app for Concord (HackHarvard 2026). It talks to the FastAPI backend in `../backend` through a dev-server proxy (`/api` → `http://localhost:8000`).

## Run

```sh
# 1. Backend (separate terminal; see ../backend)
uvicorn concord.api.main:app --port 8000

# 2. Frontend
cd frontend
npm install
npm run dev -- --port 5173     # http://localhost:5173
```

`npm run build` type-checks and writes a static bundle to `dist/`. The bundle calls `/api/...` on the same origin, so in production serve it behind something that routes `/api` to the backend.

## Views

1. **Congestion map**: sites drawn by trial load for the Actual (CT.gov), Independent and Coordinated allocations, plus a concentration table and the 10 busiest sites.
2. **Clear it**: region and assumption sliders, then `POST /api/clear`. Shows the headline cards (median speedup, share faster, trimmed dividend, trimmed PoA, dollar conversion with its caveat) and a sortable trial table.
3. **Price tags**: per-criterion months saved for one trial, and slot values. Deep link: `#prices/NCT03093116`.
4. **Pre-cleared terms**: term sheet for a coordinated (site, trial) match.
5. **Model & data**: crawl status, backtest, priors, and an eligibility-compiler playground.

The last clear result is held in app state and shared by all tabs. The default region (US-Northeast) is cleared automatically on load. The US-wide region can take up to a minute.

Map tiles: © OpenStreetMap contributors.
