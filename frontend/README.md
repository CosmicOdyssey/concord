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

1. **Congestion map**: sites sized by trial load under Registered / Best response / Coordinated (no losers) / Joint optimum, with a concentration table and the 10 busiest sites.
2. **Clear it**: scenario controls (region, β, low-history rule, universe, as-of date, sponsor, sliders) and `POST /api/clear`. Leads with the no-loser headline (coordinated vs registered), then a five-way decomposition, the assumptions and calibration check, and the trial table.
3. **Robustness**: the precomputed β × site-rate rule × universe grid (`/api/robustness`). The β = 1 rows that the master doc assumed are marked.
4. **Portfolio**: one sponsor's trials cleared with everyone else as background (`/api/sponsors`, preset "Regeneron, Sept 2024").
5. **Price tags**: per-criterion months saved for one trial, plus slot values.
6. **Pre-cleared terms**: term sheet for a headline (no-loser) match, with CMS 2026 PFS vs placeholder CLFS amounts.
7. **Model & data**: crawl status, the "does congestion exist?" regression, the backtest (model vs raw vs naive), and an eligibility-compiler playground.

Deep links: `#prices/NCT03093116` preselects a trial; `#portfolio/regeneron` loads the Regeneron portfolio instead of the default market.

The last clear result is held in app state and shared by all tabs. The default region (US-Northeast) is cleared automatically on load. Clears take about 15–25 s (US-wide about 25 s).

Map tiles: © OpenStreetMap contributors.
