# Concord Demonstration Guide

This guide covers both the **interactive HackHarvard 180-second live demonstration** and the **automated scripted video recording pipeline**.

---

# Part 1: HackHarvard 180-Second Interactive Demo

Run locally for the judges:

```sh
# Terminal 1: backend
backend/.venv/bin/uvicorn concord.api.main:app --port 8000

# Terminal 2: frontend
npm --prefix frontend run dev
```

Open `http://localhost:5173/#demo` (or use the **HackHarvard Demo** tab).

## Four-click presentation flow

Follow the [180-second script](HACKHARVARD-180-SECOND-SCRIPT.md):

1. **Next Scene**: problem setup (two trials, four shared hospitals, tight budget).
2. **Optimize Portfolio**: actual POST → existing engine → comparison; the
   transient computing scene advances on the real response, not on a timer.
3. **Next Scene**: financial responsibility and the exact run's evidence.
4. **Next Scene**: conclusion.

Optional fifth interaction: **Open Evidence Report** in scene 5. It exports the
immutable result currently shown, without running again. The inherited HTML
endpoint downloads an attachment; the same report's provenance is already
visible in the evidence scene. Do not depend on a download window during the pitch.
Reset and Previous Scene are rehearsal controls, not additional required steps.
Refresh and Reset always restore scene 1 and recompute the fixed baseline. Every
Optimize click really recomputes; the content-addressed run ID may remain identical.

## What the numbers mean

Fixture: `data/demo/hackharvard-request.json`. Two existing Regeneron-context trial
identifiers; four explicitly **synthetic** hospitals; 40 hypothetical remaining
participants per trial; $3M modeled budget; seed 7; 32 draws; independent mean-one
lognormal rate spread 0.25. This is **in-sample assumption sensitivity**, not a
calibrated enrollment prediction. New sites have a hypothetical 3-month lag.
No rate effect from support or operations; administrative savings are unrealized.

The fixture is the existing portfolio demo with only the draw count reduced from
128 to 32 (bounded repeatable presentation and exact admission) and the optional
operations effect set from 0.15 to zero (no assumed efficiency boost). No optimizer,
financial model, search admission threshold or scientific algorithm changed.
Objective: expected maximum **priority-weighted** completion (priorities 1.2 and
1.0), not the unweighted portfolio-completion measure shown for readability.
`OPTIMAL` means exact enumeration on this entered model/draw bank only.
The existing large-case `FEASIBLE_HEURISTIC` label and unknown gap are preserved.

Verified fixture outputs with bundled placeholder rates:

| Measure | Fixed baseline | Recommended allocation |
|---|---:|---:|
| Modeled final enrollment completion | 15.13 months | 9.24 months |
| P10–P90 assumed completion | 14.050–16.541 months | 8.631–9.785 months |
| Expected sponsor expenditure | $818,279.54 | $980,972.09 |
| Sponsor contingency, not expenditure | $200,000 | $200,000 |
| Expected sponsor costs including reserve | $1,018,279.54 | $1,180,972.09 |
| Conservative budget commitment | $1,133,866.40 | $1,481,066.40 |
| Budget reserved | 37.8% | 49.4% |
| Distinct hospitals / trial–site assignments | 2 / 4 | 4 / 8 |
| Capacity/slots | Feasible | Feasible |
| Censored draws | 0 | 0 |

The recommendation uses **$162,692.55 more expected sponsor expenditure**; it does
not demonstrate a saving. This example's budget is not binding: it demonstrates
capacity reallocation within a ceiling, not that the entire $3M must be spent.
Usable administrative savings: $0. Coverage, participant cost sharing and support
are unchanged between these allocations. No clinical acceleration is established.

## Provenance and limits

- `data/portfolio/context.json` is bundled current registry-context metadata,
  carrying source URLs, reported capture dates and response hashes. It is **not**
  an historical as-of data set, complete protocol, or outcome validation.
- The missing historical SQLite bundle is **not** reconstructed or implied.
- Both trials use Concord's illustrative authored NCT05800015 financial schedule;
  it is an explicit proxy for trial 2, not its actual protocol.
- This isolated demo has no CMS ratecard file. Procedure prices are approximate
  placeholders, not independently verified CMS rates or negotiated sponsor costs.
- Potential insurer amount is a responsibility/coverage assumption, not insurer
  participation, confirmed coverage, reimbursement or a financing partnership.
- Patient geography, clinical eligibility, external trials, real staffing,
  downstream outcomes and actual hospital margins remain unvalidated.
- The app's earlier predictive headlines are not used. Historical predictive
  performance is **UNVERIFIED for this demo**.

## Failure and fallback

If computation has not completed after about 10 seconds, explain the pending
state. The client fails after 15 seconds; no outcome is substituted. Choose
**Load saved rehearsal (not live)** explicitly. Its banner, timestamps, hashes
and report say **SAVED RESULT REPLAY**. Saved bytes are SHA-256 checked against
the capture digest; an altered file is rejected. Saved artifacts are a genuine
prior computation, not an animation or a hand-authored result.

If all browser interaction fails, open `frontend/public/demo/saved-report.html`
as a local file. Say that it is the saved rehearsal. Never claim another live run.

To intentionally refresh the fallback after reviewed code changes:
`backend/.venv/bin/python scripts/capture-demo.py`, inspect the genuine capture
and dirty/source identity, then rebuild the frontend. This is an explicit operator
step, not part of presentation startup. Do not overwrite evidence merely to make
numbers more attractive.

## Verification

```sh
(cd backend && .venv/bin/python -m pytest -q)
(cd frontend && npm test && npm run typecheck && npm run build && npm run lint)
node "$FLEET_CLI" verify --json
```

`FLEET_CLI` is the installed existing Engineering Fleet `dist/cli.js`; on the
acceptance machine it is `/Users/sadius/engineering-fleet-true-succession/dist/cli.js`.
The tracked `.fleet/config.json` runs every deterministic check. Fleet campaign:
**CONCORD-HACKHARVARD-DEMO**, local tasks `concord-demo-implementation` and continuation `concord-demo-integrated`. It never
creates a remote execution authority, consumes a previous mission approval or
modifies the Fleet daemon/supervisor. See `ACCEPTANCE.md` for actual fresh results.

Backend unavailable but static browser still usable: serve only the built files:
`python3 -m http.server 18082 --bind 127.0.0.1 --directory frontend/dist`, then open
`http://127.0.0.1:18082/#demo`. The missing API is shown as an error; explicitly
choose the saved rehearsal. This path was exercised with a real static-only
server, not a mocked successful API response.

---

# Part 2: Automated Video Recording & Voiceover

- `script.md`: the 2:57 voiceover script (12 scenes), with what is on screen, the spoken lines, recording notes and an
  honesty checklist.
- `scenes.json`: the same scenes for the recorder (start times, durations, narration, actions with selectors).
- `../../scripts/demo/record.mjs`: one-command scripted screen recording of the running app.

## Record

Needs the app running (frontend on http://localhost:5173, backend venv in `backend/.venv`), installed Chrome, and the
npm packages `puppeteer-core` and `ffmpeg-static` on `NODE_PATH` (they live in the gitignored `data/work/D`).

```bash
NODE_PATH=data/work/D/node_modules node scripts/demo/record.mjs
```

PowerShell: `$env:NODE_PATH = 'data/work/D/node_modules'; node scripts/demo/record.mjs`

It rehearses every scene off camera first (warms every route so no spinner shows), then records at 1920x1080, 30 fps,
H.264, with an eased cursor, click ripples and a brief highlight on what is being discussed. Output in `data/work/demo/`:
`concord-demo.mp4`, `concord-demo.srt` (the narration as subtitles, to read along), `chapters.txt`, `record-log.json`
(timing and any problems) and `frames/` (one frame every 3 s). A take takes about 5 minutes.

## Watch

PowerShell: `Invoke-Item data\work\demo\concord-demo.mp4` (or `start "" data\work\demo\concord-demo.mp4` in cmd).
With subtitles: `vlc data\work\demo\concord-demo.mp4 --sub-file=data\work\demo\concord-demo.srt`.

## Change pacing or content

Edit `scenes.json` (each scene's `start_s`, `duration_s`, and each action's `at_s`, `type`, `target`) and re-record. Keep
`script.md` in step with it.

## Add the voiceover

Record your voice while the video plays (read the `.srt`), save it as `voice.wav`, then either drop both into any video
editor, or:

```bash
FF=$(node -e "console.log(require('ffmpeg-static'))")   # with NODE_PATH as above
"$FF" -i data/work/demo/concord-demo.mp4 -i voice.wav -c:v copy -c:a aac -shortest data/work/demo/concord-demo-voice.mp4
```

## How product teams usually do it

1. Scripted capture (this): a headless browser plays the product on a timeline, so every take is identical and a UI
   change is one re-run away.
2. Screen Studio, Loom or similar: a person records, and the tool adds smooth zooms, cursor smoothing and backgrounds.
3. Interactive demos (Arcade, Supademo): clickable walkthroughs instead of video.
Most teams record the voiceover separately and lay it over the finished capture, as here.
