# Concord: HackHarvard 2026 submission (Regeneron track)

## Elevator pitch (under 200 characters)

Turn a clinical trial protocol into a site budget both sides can check: procedures priced from public Medicare
rates, with a source on every line.

## Try it out

- Live app: https://flashing-bush-todd-indices.trycloudflare.com (hosted from the team's laptop for judging)
- Code: https://github.com/CosmicOdyssey/concord

## Project story

### Inspiration

Before a clinical trial can enroll its first patient, each hospital and the sponsor have to agree on a budget. In
WCG's 2025 survey, 73% of 611 research sites named budgets and contracts as a top contributor to start-up delay. The
two sides usually negotiate from numbers the other side can't reproduce: sponsors use subscription benchmarks built
from blinded contracts, and sites price from their own chargemaster and coverage analysis.

We started somewhere else. Our first idea was a "clearing house" that would allocate sites across a sponsor's
concurrent trials so they stop competing for the same patients. We tested it on 7,221 non-small cell lung cancer
trials from ClinicalTrials.gov, and it didn't hold up. Coordination gains largely disappeared on data the model hadn't
seen (1.42x in-sample, about 1.05x held out). Competing trials barely slowed each other within a site (an effect of
0.09, against the 1.0 we had assumed). And public registry data predicts site performance only weakly. So we stopped
forecasting, and built the part of the problem that public data can actually answer.

### What it does

**Protocol to terms** turns a trial's schedule of assessments into a budget both sides can check:

- **Coverage.** Each visit and procedure gets a draft label under Medicare's clinical-trial policy (NCD 310.1):
  routine care billed to insurance, or research the sponsor pays. Every rule is shown, and a reviewer can override it.
- **Budget.** Every coded procedure is priced from the CMS 2026 physician fee schedule at the site's Medicare locality,
  and labs from the 2026 clinical lab fee schedule. Every line shows its source, and any line can be opened to show its
  price step by step: units × the locality's adjustments × the 2026 conversion factor, with a link to check it on
  CMS's own lookup tool.
- **Anchored share.** How much of the budget is settled by public rates before anyone negotiates. On Regeneron's
  fianlimab protocol at NYU Langone, 20% of the per-participant sponsor budget is public CMS rates, 60% is a labelled
  proposed standard for non-procedure fees, and 20% is overhead, which is an assumption.
- **Why two sites differ.** A two-site comparison splits the gap into Medicare's three geographic adjustments, and
  places each site among all 109 Medicare localities.
- **Site proposal check.** Paste a site's proposed budget as a CSV. Each coded line is flagged above, below or inside a
  user-set range around the Medicare rate, and every other line is flagged "needs itemized justification". The result
  exports as a counter-proposal with a source on every line. The demo uses a clearly labelled synthetic proposal.
- **Any trial.** Add a trial by its NCT ID. Concord pulls its record and U.S. sites from ClinicalTrials.gov, and takes
  the schedule as an uploaded CSV, or drafts one from the registry with every item cited.

**Portfolio overlap** shows where a sponsor's own concurrently recruiting trials share registered sites and eligible
patients. For example, two of Regeneron's fianlimab trials shared 16 registered U.S. sites. Patient overlap is
computed on a synthetic population, and lung cancer is covered in full; breast cancer shows shared sites only.

**Findings** publishes what we tested, including the results that sank our first idea.

Concord is decision support, not a fair-market-value legal opinion. Every number has a public source or a visible
"assumption" label.

### How we built it

- A crawler for the ClinicalTrials.gov API v2 built a SQLite database of NSCLC trials and their registered sites, with
  site de-duplication and handling for sponsors that anonymize their sites.
- The rate card loads the CMS 2026 physician fee schedule (RVU file, GPCIs for all 109 localities, conversion factor)
  and the 2026 clinical lab fee schedule.
- The backend is Python and FastAPI. It handles coverage rules, pricing, anchoring, ranges, the locality distribution,
  the proposal check, and term sheet and counter-proposal exports.
- The research side used a Poisson-gamma model of site enrollment rates, regressions with site fixed effects and
  two-way clustered standard errors, pre-registered held-out tests, and a check of the site scores against observed
  enrollment.
- The frontend is React and TypeScript on Vite. Every screen has a Simple mode, with details in hover cards, and a
  Detailed mode, in light and dark themes.
- Hundreds of automated browser checks (puppeteer) run against every view. The demo video itself is a scripted
  browser recording.

### Challenges we ran into

- **Our own thesis failed.** We had to decide to publish the negative results rather than bury them, and rebuild the
  product around what survived.
- **Keeping claims honest.** A "budget" figure is easy to overstate. We separated what public rates settle from what is
  Concord's proposal and what is an assumption, and labelled each one.
- **Messy public data.** Some sponsors anonymize every site. Medicare localities aren't in the registry. Lab prices
  don't vary by site. Some codes have no Medicare amount at all, and we show them as unpriced rather than as zero.

### Accomplishments that we're proud of

- A budget where every line can be traced to a public file or is labelled an assumption.
- A clear, measured negative result, published alongside the product it led to.
- Any trial can be added by NCT ID, beyond the hand-authored demos.

### What we learned

- Optimizing site selection needs site-level enrollment data. The public registry reports enrollment per trial, never
  per site, and that data is private today.
- Medicare's public rates settle only part of a trial budget, about a fifth of it in our demo. Showing that split is
  useful in itself.

### What's next

- Reading the schedule of assessments straight from protocol documents.
- Pricing sites that aren't registered on the trial, by ZIP code.
- Our ask: with site-level enrollment data shared by sponsors, the site-selection question we started with becomes
  answerable.

## Built with

python, fastapi, uvicorn, sqlite, numpy, scipy, pydantic, pytest, react, typescript, vite, leaflet, puppeteer, ffmpeg,
clinicaltrials.gov-api, cms-physician-fee-schedule, cms-clinical-laboratory-fee-schedule, cloudflare-tunnel

## Team

The Bruno Bears, Brown University.
