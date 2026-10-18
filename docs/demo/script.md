# Concord demo video: script and shot list

**Runtime: 2:57 (177 s), 12 scenes.** About 400 spoken words. Read at about 145 words per minute while speaking, with short pauses between scenes.

**Audience:** HackHarvard judges, plus Regeneron clinical operations and portfolio people.

**Format:** a screen recording of the live app with a human voiceover recorded separately. `scenes.json` in this folder has the same scenes and timings in machine-readable form for the automated recorder.

**Story:** budgets are negotiated on numbers the other side can't reproduce. Concord shows how much of a real budget rests on public rates, and it shows the math line by line. It explains why two sites differ and checks a site's proposal. A second tool finds overlap inside a sponsor's own portfolio. We close with what Concord does not do and what didn't work.

| # | Scene | Start | Length | On screen | Key line |
|---|---|---|---|---|---|
| 1 | hook | 0:00 | 16 s | Landing hero, slow scroll to the two-site preview | 73% of 611 sites: budgets and contracts |
| 2 | open-terms | 0:16 | 12 s | Header button opens Protocol to terms, step 1 | Regeneron fianlimab trial, illustrative schedule |
| 3 | coverage | 0:28 | 12 s | Step 2, coverage grid | Routine care vs research, draft labels |
| 4 | budget-anchored | 0:40 | 18 s | Step 3, NYU Langone, anchored share | 20% public / 60% proposed standard / 20% open |
| 5 | line-detail | 0:58 | 18 s | Detailed, step 6, the line's step-by-step table | 71260: units x adjustments x $33.4009 = $191.25 |
| 6 | compare-sites | 1:16 | 15 s | Simple, step 4, gap split, 109 localities | Hattiesburg $375.01 lower: geography, not a saving |
| 7 | proposal-check | 1:31 | 18 s | Step 5, SYNTHETIC sample, export | 5 above range; CT at $1,150.00; counter-proposal |
| 8 | any-trial | 1:49 | 11 s | Step 1, add NCT05785767 | Any trial with U.S. sites, by NCT ID or CSV |
| 9 | overlap | 2:00 | 16 s | Portfolio overlap, Regeneron preset | 16 shared registered sites; synthetic population |
| 10 | compares | 2:16 | 14 s | Landing, How Concord compares | Not stated publicly by 20 products; CMS tool; benchmarks |
| 11 | tested | 2:30 | 10 s | Landing, What we tested | Coordination didn't hold up on held-out data |
| 12 | close | 2:40 | 17 s | Sources, closing line | Decision support; free, open; the ask |

---

## Before you record

- **The app.** The frontend at http://localhost:5173 and the API at http://localhost:8000, both running.
- **Window.**
  - Viewport 1440 x 810 CSS pixels (16:9), light theme, Simple density.
  - Record at device scale factor 2 and export at 1920 x 1080. Device scale factor 4/3 gives 1920 x 1080 frames directly.
- **A fresh browser profile for every take.** Before the first page load, set these localStorage keys:
  - `concord.theme` = `light`
  - `concord.density` = `simple`

  Leave every `tf:*` key unset. With the default state, Protocol to terms opens on NCT05800015 at NYU Langone.
- **The added trial.** Scene 8 adds NCT05785767 by NCT ID. The API caches it under `data/work/registry_cache/`, which is gitignored.
  1. Run one rehearsal take first. It fetches the ClinicalTrials.gov record once.
  2. Before every later take, delete only `data/work/registry_cache/NCT05785767.protocol.json`. Keep `NCT05785767.study.json` and `NCT05785767.json`.

  The add then runs offline in under a second, and step 1 shows three trial cards again before the add. No restart is needed: the trial list is read from disk on every request.
- **Downloads.** Point the browser's downloads at a known folder. Scene 7 opens the exported file from that folder.
- **Protocol to terms shows one step at a time.** Its steps are tabs, with a sticky step nav and Back/Next buttons. Each step has a deep link, for example `#terms-flow/NCT05800015/budget`. Scenes reach steps by clicking the step nav, as a viewer would.

---

## Scenes

Timings are scene start and length. `[beat]` marks a short pause of about half a second. Numbers in the voiceover are written the way they are said. The on-screen figure follows in brackets in the "Numbers" line.

### 1. hook: 0:00, 16 s

**On screen.** Landing page (`/#home`), Simple, light.
- The take opens on a still hero: "Turn a trial protocol into a budget both sides can check."
- At 0:06 the page scrolls slowly (7 s) down to the live Protocol to terms preview card. It shows NYU Langone vs Hattiesburg Clinic and the sentence "Before anyone negotiates: $1,339.95 (20%) ... anchored to public CMS 2026 rates".
- The page holds there.

**Voiceover.**
> Trial budgets get negotiated on numbers the other side can't reproduce. [beat] In WCG's twenty twenty-five survey, seventy-three percent of six hundred eleven sites named budgets and contracts as a top contributor to start-up delay.

**Numbers.**
- 2025, 73% and 611: How Concord compares, card "Why it matters: what sites report" (WCG 2025 Site Challenges Report, Q16), and `docs/competitive-landscape.md` section 4.
- The stat card is lower on the same page (scene 10). In the edit, add a lower-third caption: "WCG 2025 Site Challenges Report, Q16: 73% of 611 sites".

### 2. open-terms: 0:16, 12 s

**On screen.**
- The cursor moves to "Open Protocol to terms →" in the sticky landing header and clicks at 0:19.8.
- Protocol to terms opens on step 1, Protocol (`#terms-flow/NCT05800015`).
- The page scrolls to the step 1 header: 16 visits, 27 procedures, 139 scheduled items. The three trial cards sit below.
- The cursor rests on the selected Regeneron card (NCT05800015, Ph 2/Ph 3, 29 registered U.S. sites).
- The strip reads "Illustrative, authored from public trial information".

**Voiceover.**
> Concord turns a protocol into a budget both sides can check. [click] Here's one of Regeneron's fianlimab trials in lung cancer, with an illustrative schedule from the public record.

**Numbers.** None spoken. On screen: 16 visits, 27 procedures, 139 scheduled items.

### 3. coverage: 0:28, 12 s

**On screen.**
- Click step nav "2 Coverage" (`#terms-flow/NCT05800015/coverage`). The step shows "56 of 139 scheduled items are research-only ... The other 83 are routine care", the split bar and rules R1 to R5.
- At 0:33.5, click "Schedule grid and reviewer overrides". The page scrolls slowly into the grid: grey cells are routine care, blue cells are research, and each cell names its rule.
- Do not click a grid cell. A click flips that item's coverage.

**Voiceover.**
> Each item gets a draft label: routine care, billable to insurance under Medicare's clinical-trial policy, or research, paid by the sponsor. [beat] A reviewer can override any label.

**Numbers.** None spoken. On screen: 83 routine, 56 research, rules R1 to R5, NCD 310.1.

### 4. budget-anchored: 0:40, 18 s

**On screen.**
- Click step nav "3 Budget" (`/budget`). The step reads: "At NYU Langone Health Perlmutter Cancer Center, New York, NY, the sponsor pays $6,568.67 per participant". The cursor touches the $6,568.67 figure.
- At 0:44 the page scrolls to "What the sponsor amount is anchored to".
- The cursor hovers "Anchored to public rates". Its card lists physician fee schedule lines $1,294.77 and lab fee schedule lines $45.18, with the CMS file names.
- The cursor moves right to "$3,915.00 59.6%", then to "$1,313.72 20.0%".
- "Range per participant $6,568.67 – $7,406.11" is visible beside them.

**Voiceover.**
> At NYU Langone in Manhattan, the key number is the anchored share. [beat] Twenty percent is priced from public CMS rates, so both sides can check it. Sixty percent is Concord's proposed standard, an assumption. The last twenty, overhead, is open to negotiation.

**Numbers.**
- 20%, 60% and 20%: [$1,339.95 20.4%, $3,915.00 59.6%, $1,313.72 20.0% of $6,568.67].
- These appear in step 3 and in the landing preview ("(20%)", "(60%)", "(20%)").
- Also in `docs/mentor-report-2026-10-17.md` and `docs/decisions.md` #26.

### 5. line-detail: 0:58, 18 s

**On screen.**
- Click "Detailed" in the app header, on camera. Then click step nav "6 Term sheet" (`/term-sheet`).
- The page scrolls to "How this line's price is built: CT chest with contrast (71260), Cycle 7 Day 1".
- The cursor walks down the table:
  - total units 4.99
  - Manhattan's regional adjustments 1.064 / 1.162 / 1.586
  - "x $33.4009", the 2026 conversion factor
  - "= Medicare rate $191.25" (Site B, Mississippi: $148.38)
- At 1:11 the page scrolls a little. The cursor hovers "Check this on CMS ↗" without clicking; the link opens CMS's Physician Fee Schedule Look-Up Tool in a new tab.

**Voiceover.**
> Each line shows its math. [beat] A CT chest, code seventy-one two sixty: CMS's units, times Manhattan's regional adjustments, times thirty-three point four oh oh nine dollars per unit, equals a hundred ninety-one twenty-five. [beat] Check it on CMS.

**Numbers.**
- 71260, $33.4009 and $191.25: step 6, Detailed table.
- $33.4009 is also on the landing Sources list and in README section 5.
- $191.25 is also in the mentor report's note on CPT 71260.

### 6. compare-sites: 1:16, 15 s

**On screen.**
- Click "Simple" in the header, then step nav "4 Compare" (`/compare`). The preset "Manhattan vs Mississippi" is on.
- Lede: "The sponsor budgets differ by $375.01 per participant because Medicare adjusts physician fees for local costs ...".
- The page scrolls to the gap split:
  - doctor's time -$13.30
  - practice costs -$270.04
  - malpractice insurance -$16.69
  - overhead on those -$74.99
- At 1:24.6 the page scrolls to "The same procedures in every Medicare locality": 109 dots, Site A at the 87th percentile, Site B at the 1st. The cursor touches the Site A figure.
- The page ends on "What widens the range", where each assumption band is labelled.

**Voiceover.**
> Why does another site differ? Hattiesburg, Mississippi is three hundred seventy-five dollars lower per participant: Medicare's geographic adjustments, not a saving. [beat] Here's the same protocol across all one hundred nine Medicare localities.

**Numbers.**
- $375.01: step 4 lede and gap split, and the landing preview ("Site B's sponsor total is $375.01 lower").
- 109: step 4 locality strip and the mentor report.

### 7. proposal-check: 1:31, 18 s

**On screen.**
- Click step nav "5 Site proposal" (`/proposal`), then "Load synthetic sample". The result shows:
  - "Synthetic sample. Invented prices to demonstrate the check, not a real site's proposal and not market data."
  - 5 above range, 2 below range, 9 needs itemized justification, 1 not in this protocol's schedule, 4 in range
- The cursor hovers "assumption" next to the band. Its card reads "The band is an assumption", for a band of 100%-150% of Medicare.
- The cursor moves to "5 above range", then to "$1,150.00" on "CT abdomen and pelvis with contrast $1,150.00 against $344.97–$517.46".
- The page scrolls down a little, and the cursor clicks "Download counter-proposal (HTML)".
- At 1:44.6, cut to the downloaded file, `counter-proposal_NCT05800015_334d690736c4_SYNTHETIC.html`. It opens with "SYNTHETIC: Counter-proposal: NCT05800015 at NYU Langone ...", then lists the site and locality, the CMS files, the band assumption and the summary. Hold 4 s.

**Voiceover.**
> Now, a site's proposal: a synthetic sample with invented prices. Each line is checked against Medicare at the site's locality, times a band you set. [beat] Five sit above range, like this CT at eleven fifty. [beat] Export a sourced counter-proposal.

**Numbers.** 5 and $1,150.00 come from step 5 with the synthetic sample, and from the exported file.

### 8. any-trial: 1:49, 11 s

**On screen.**
- Cut back to Protocol to terms step 1 (`#terms-flow/NCT05800015`).
- The page scrolls to "Add any trial by NCT ID". The cursor types NCT05785767 and clicks "Add trial".
- The trial is added and selected (`#terms-flow/NCT05785767`). The page scrolls to "Schedule source · Draft from the public record", which shows:
  - 4 visits inferred, 21 items inferred
  - 10 items unpriced: "10 procedures, listed, never counted as zero"
  - "Draft from the public record, not the sponsor's protocol."
- The cursor rests on the CSV box.

**Voiceover.**
> Any trial with U.S. sites can be added by NCT ID. [beat] Concord drafts a cited schedule from the registry, or takes the real one as a CSV.

**Numbers.** None spoken. NCT05785767 is typed. On screen: 4, 21 and 10.

### 9. overlap: 2:00, 16 s

**On screen.**
- Click the app tab "Portfolio overlap", then the preset "Regeneron, Sep 1, 2024" (`#overlap/regeneron`). The view shows lung cancer, all U.S. sites, 5 trials and 10 pairs.
- The page scrolls to the matrix. The cursor hovers the selected cell "16" (NCT05785767 x NCT05800015); its card shows the pair.
- At 2:09 the page scrolls to "Selected pair":
  - shared registered sites (all U.S. sites): 16
  - NCT05785767's eligible patients also eligible for NCT05800015: 100%
  - the reverse: 26%
  - "Synthetic population. Registered sites, not confirmed enrolling." is visible under the matrix
- The cursor touches "PD-L1 TPS ≥ 50%", listed under "Only in NCT05785767".

**Voiceover.**
> A second tool checks a sponsor's own trials against each other. [beat] Regeneron's two fianlimab trials shared sixteen registered U.S. sites. On a synthetic population, every simulated patient eligible for the stricter trial also qualified for the other.

**Numbers.**
- 16 and "every ... also qualified" [100%]: Portfolio overlap with the Regeneron preset, the landing overlap preview, and README section 4 ("overlap 1.0").
- "Stricter" is from the criteria diff: "None: NCT05785767 restricts everything NCT05800015 does."

### 10. compares: 2:16, 14 s

**On screen.**
- Cut to the landing page at How Concord compares (`/#home/compare`).
- The matrix "What each product states publicly · 8 of 20 products · 6 of 13 capabilities" is on screen.
- The cursor hovers Concord's "Yes" under "Medicare fee-schedule prices with locality adjustment". Its evidence card opens. Every other row in that column reads "–", which means not stated publicly.
- The cursor moves to the card's title strip, and the evidence card closes.
- At 2:21.4 the page scrolls to "Concord does; the 20 others do not state publicly". Each item carries its limit in amber: "The per-code lookup itself is not new: CMS's free PFS Look-up Tool gives it one code at a time".
- The cursor moves to "What they have that we don't".

**Voiceover.**
> Of twenty products we reviewed, none says publicly that it prices budget lines at the site's Medicare locality. [beat] CMS's free tool does it one code at a time. They have negotiated-price benchmarks; we don't.

**Numbers.** 20 comes from the landing ("8 of 20 products", "the 20 others") and `docs/competitive-landscape.md` sections 1-3.

### 11. tested: 2:30, 10 s

**On screen.**
- The page scrolls to "What we tested", then to "Coordinating sites across trials did not hold up on held-out data". That row reads "1.42× in-sample, 1.05× held-out (1.00× = no gain)".
- Hold.

**Voiceover.**
> Our first idea, coordinating sites across trials, didn't hold up on held-out data. [beat] So the product sticks to counts, criteria and sourced prices.

**Numbers.** None spoken. On screen: 1.42×, 1.05× and 51%.

### 12. close: 2:40, 17 s

**On screen.**
- The page scrolls to Sources: CMS 2026 Physician Fee Schedule (conversion factor $33.4009), CMS 2026 Clinical Laboratory Fee Schedule, Medicare NCD 310.1, Concord proposed standard schedule (an assumption), ClinicalTrials.gov and the synthetic NSCLC population.
- At 2:47 the page scrolls to the closing line, "Price a protocol line by line, and see where every number comes from."
- The footer reads "Built by the Bruno Bears, a team from Brown University ..." and shows the GitHub link.
- The cursor rests on "Open Protocol to terms →".
- Fade to black over the last 1.5 s.

**Voiceover.**
> Concord is decision support, not a fair-market-value legal opinion. [beat] Free, open source, every number sourced or labelled an assumption. Built by the Bruno Bears at Brown. [beat] Our ask: site-level enrollment data. The registry never reports it.

**Numbers.** None spoken.

---

## Recording notes

**Mic and room.**
- Use a USB dynamic or condenser mic, 15-20 cm from the mouth, slightly off-axis, with a pop filter.
- Record in a small soft room: closet, bedroom with curtains, or under a blanket. Laptop fans off, phone silent.
- Record WAV at 48 kHz, 24 bit, with peaks around -6 dBFS. Capture 5 s of room tone at the start for noise reduction.
- Normalize the final mix to about -16 LUFS.

**One clip per scene.** Name the files `01-hook.wav` to `12-close.wav`. Separate clips let you re-take one line without re-recording the video. Each clip starts at its scene's start time in the edit.

**Pacing.**
- Aim for about 145 words per minute: a little slower than conversation.
- Say each number crisply and pause after it.
- If a clip runs longer than its scene, lengthen that scene's `duration_s` in `scenes.json` and shift the later `start_s` values, rather than rushing.

**Where to pause.**
- After the hook's first sentence.
- After "both sides can check" in scene 2, while the click lands.
- Before "Check it on CMS" in scene 5.
- After "not a saving" in scene 6.
- Before "Export" in scene 7.
- Before "Our ask" in scene 12.
- Leave about 0.5 s of air at each scene boundary.

**Pronunciation.**

| Word | Say |
|---|---|
| fianlimab | fee-AN-li-mab |
| NYU Langone | N-Y-U lang-GOH-nee |
| Hattiesburg | HAT-eez-burg |
| WCG, CMS, NCT ID, CSV | say the letters |
| 71260 | seventy-one two sixty |
| $33.4009 | thirty-three point four oh oh nine dollars |
| $191.25 | a hundred ninety-one twenty-five |
| $1,150.00 | eleven fifty |

**If the read runs long, trim in this order. Never cut the honesty lines.**
1. Scene 8: drop "or takes the real one as a CSV". The CSV box stays on screen. Saves about 2 s.
2. Scene 6: drop "Here's the same protocol across all one hundred nine Medicare localities." Also cut the scene to 12 s. Saves about 3 s.
3. Scene 11: drop "So the product sticks to counts, criteria and sourced prices." Saves about 3 s.

**Keep these lines:**
- "illustrative"
- "draft label" and "a reviewer can override"
- "an assumption"
- "not a saving"
- "synthetic sample with invented prices"
- "a band you set"
- "on a synthetic population"
- "says publicly"
- "CMS's free tool does it one code at a time"
- "they have negotiated-price benchmarks; we don't"
- "decision support, not a fair-market-value legal opinion"

**Assembly.**
1. Lay the 12 clips on the timeline at their start times over the screen recording.
2. Add the WCG caption in scene 1.
3. Optionally add slow 110% zooms on:
   - the anchored-share card (0:44-0:56)
   - the line table (1:02-1:10)
   - the proposal tally (1:36-1:42)
4. Fade in at 0:00 and out at 2:55.5.
5. Export 1920 x 1080, 30 fps, H.264.

---

## How the recording is automated (contract for `scenes.json`)

This is how product teams usually make demo videos. They write a script and a shot list, then record the screen in a clean browser at a fixed window size, either driven by a script or rehearsed by hand. They record the voiceover separately and cut it to the picture. Zooms and captions are added in the edit. `scenes.json` drives the screen part. Any recorder that follows the rules below reproduces the shot list.

**Top-level settings** (not stored in the JSON file):
- Base URL http://localhost:5173.
- Viewport 1440 x 810.
- Fresh profile, set up as in "Before you record".
- A known download folder.

**Timing.**
- `at_s` is relative to the scene start. Run the actions in order, and never start one before its `at_s`.
- Scenes play back to back at `start_s`; the total is 177 s.

**Action types:**
- **`goto`**
  - When it is the first action of a scene, at `at_s` 0, it is a cut. Pause capture, load the route (base URL + `target`), and wait for network idle (up to 5 s) and fonts. Then resume, and start the scene clock. Scene 1's `goto` is the pre-roll.
  - `download:<file>` opens that file from the download folder. Wait up to 6 s for the file, and treat the load as a cut.
- **`wait`**
  - With a `target`, block until that element is visible (not inside `[hidden]`), for at most `duration_s`.
  - Without one, just wait.
- **`scroll_to`**
  - Scroll so the target's top lands `offset_px` below the viewport top. The default is 96.
  - Protocol to terms keeps a sticky header and step nav about 112 px tall, so offsets there are 110 or more.
  - Use an ease-in-out curve over `duration_s`, clamped to the page bounds.
  - A numeric target is an absolute page y.
- **`scroll_by`**: `target` is a pixel delta (positive means down), eased over `duration_s`.
- **`hover` / `click`**
  - Move a visible cursor along an eased path over about 85% of `duration_s`. A `click` then does a real pointer press and release (`page.mouse.down/up`).
  - Never use `element.click()`. The step tabs treat a scripted click (`detail` 0) as keyboard activation and move focus to the step heading.
  - If the target's centre is outside the viewport, scroll it in first.
- **`type`**: click the input, then type `text` evenly over `duration_s`.

**Targets.**
- A CSS selector: use the first visible match.
- `{text, scope}`: search `a, button, summary, label, [role=tab], [role=button]` inside `scope` (default `body`), visible elements only.
  - Compare whitespace-collapsed `innerText` in this order: exact, starts-with, ends-with, includes. The first match wins.
  - Step nav buttons read like "3 Step 3: Budget", with the number and a screen-reader prefix. The ends-with rule matches them.
  - `nav[aria-label="Steps"]` and the `#tf-step-N` panels exist with tabs and with the older one-page layout.

**Cursor and capture.**
- Headless captures show no cursor, so inject a small cursor overlay. A subtle 18-24 px dot, plus an optional click ripple.
- Capture with CDP `Page.startScreencast` or OBS on a headed Chrome, at 30 fps.
- Take no screenshots during a take: they stall frames.

**Checked 17 Oct 2026.** A full dry run against the live app found 0 missing or hidden targets. Every step is reached through the step-tab nav, and each scene's address matched its `route`. The dry run used real pointer clicks, with `/api` forwarded to a scratch API so the add-trial cache stayed untouched.
- Actions started at most about 1 s late, and scenes overran by at most 0.6 s. Both come from screenshotting after every action, which a recorder does not do.
- Switching to Detailed re-renders for about 0.8 s, and the timings allow for it.

---

## Numbers used, and where they appear

| Spoken | On screen / source | Where |
|---|---|---|
| 2025, 73%, 611 sites | "73% of 611 sites named budgets and contracts as a top contributor to start-up delay", WCG 2025 Site Challenges Report Q16 | Landing, How Concord compares, "Why it matters"; `docs/competitive-landscape.md` sections 1 and 4 |
| twenty percent (public CMS rates) | $1,339.95, 20.4% of $6,568.67; "20%" in the lede and landing preview | Terms step 3 (NYU Langone); landing preview; mentor report; decisions #26 |
| sixty percent (proposed standard) | $3,915.00, 59.6%; "(60%)" in the landing preview | Same |
| the last twenty (overhead, open) | $1,313.72, 20.0%; overhead 25% is an assumption | Same |
| 71260 | CT chest with contrast (71260), Cycle 7 Day 1 | Terms step 6 |
| $33.4009 | "x $33.4009", CMS CY 2026 conversion factor | Terms step 6 (Detailed); landing Sources; README section 5; counter-proposal export |
| $191.25 | "= Medicare rate $191.25" at Manhattan (NY 01) | Terms step 6; mentor report note on CPT 71260 |
| $375 (three hundred seventy-five) | $375.01 lower per participant, Site B - Site A | Terms step 4; landing preview |
| 109 localities | "across the 109 Medicare localities", 109 dots | Terms step 4; mentor report |
| five above range | "5 above range" (SYNTHETIC sample) | Terms step 5; counter-proposal export |
| eleven fifty | CT abdomen and pelvis with contrast $1,150.00 against $344.97–$517.46 | Terms step 5; counter-proposal export |
| sixteen registered U.S. sites | "Shared registered sites (All U.S. sites) 16" | Portfolio overlap, Regeneron preset; landing overlap preview; README section 4 |
| every simulated patient eligible for the stricter trial also qualified | "NCT05785767's eligible patients also eligible for NCT05800015 100%", on a synthetic population of 20,000 simulated patients | Portfolio overlap; landing; README section 4 ("overlap 1.0") |
| twenty products | "8 of 20 products", "the 20 others do not state publicly" | Landing, How Concord compares; `docs/competitive-landscape.md` |

Typed but not spoken: NCT05785767 (scene 8).

## Honesty checks

| Rule | How the script meets it |
|---|---|
| No promise of faster trials, faster enrollment, faster negotiation, better site selection or savings | No such line. The WCG figure is a cited pain point, not a claim. Scene 6 says "not a saving". |
| Insurer and Medicare amounts are benchmarks | Spoken as public rates "both sides can check" and as "a band you set". |
| Decision support | "Decision support, not a fair-market-value legal opinion" is spoken in scene 12 and on screen in scenes 4 to 7. |
| Demo protocols are illustrative | Spoken in scene 2. The step strip says so on every Terms step. |
| The proposal check uses a SYNTHETIC sample | "a synthetic sample with invented prices" is spoken. The banner and the export title say SYNTHETIC. |
| Eligibility overlap is on a synthetic population | "On a synthetic population, every simulated patient ..." is spoken. |
| Competitors are described only as "not stated publicly" | "none says publicly". The CMS free tool and negotiated-price benchmarks are said out loud. |
| Coverage is a draft | "draft label", "a reviewer can override". |

## One thing to fix before recording

The landing's "Concord does" list (on screen at 2:21-2:30) still says: "On the NSCLC demo (NCT05800015, first listed site, Arizona locality), only 18% is anchored to public rates". The voiceover, step 3 and the landing preview all use the default site, NYU Langone, at 20%. Both figures are right for their own sites. But a viewer hears 20% and then reads 18%.

The fix: update the K6 line in `docs/competitive-landscape.md` to NYU Langone, 20.4%, and regenerate the landing data. The judge-question answer in section 5 of that file also says 18% / 62% / 20%, so update it too.
