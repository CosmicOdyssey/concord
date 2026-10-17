# Concord competitive landscape: trial budgets, coverage and site selection

Prepared 17 Oct 2026 for the Concord pitch (HackHarvard 2026, Regeneron track).

**How this was checked.** A vendor sweep was followed by a separate verification pass. Corrections from that pass are applied here, and claims it could not support are dropped. On 17 Oct we fetched the pages for UpSite TrialPro, Evinova, Citeline, Dataiku and Medidata Grants Manager again, along with the WCG 2025 site survey and the Advarra coverage-analysis survey, and checked them directly.

**Completeness pass (17 Oct).** This pass added five products: Faro, TriNetX, and three site CTMSs (Advarra Clinical Conductor, CRIO Site CTMS, RealTime-CTMS) grouped in one row. It also added the free CMS PFS Look-up Tool as a public baseline for column 4. The pass ran out of web searches, so it fetched known vendor pages directly. These plausible candidates were not checked: Epic's research billing, Oracle's CTMS and site payments, Lokavant and Phesi.

**Rule used throughout.** "Not stated publicly" means the vendor's public pages do not say it. It does not mean the product lacks the capability. Every vendor number below is the vendor's own claim unless a third party is named.

---

## 1. Summary

As the vendors' own pages describe it, trial budgets are mostly settled today with proprietary data and human services.

- **Sponsors and CROs** benchmark investigator grants against subscription databases built from blinded, negotiated contracts. IQVIA GrantPlan reports 655K finalized budgets. Medidata Grants Manager reports 450+ contributing sponsors. Suvoda/Greenphire draws on "billions of dollars in contracted site payments". Suvoda, Medidata, IQVIA, Ledger Run and Veeva connect budgets to site payments, and Ledger Run adds CTA redlining.
- **Sites, especially academic medical centers,** run a Medicare coverage analysis protocol by protocol. They store it in a CTMS (Advarra OnCore, Veeva SiteVault, WCG Velos; Clinical Conductor, CRIO and RealTime state site budgets and receivables) priced from their own chargemaster, or buy it as a service: WCG reports "3.6k+" analyses a year and Huron claims "14000+" coverage analyses.
- **Among the products reviewed, the only one that states both coverage analysis and benchmarked budgeting** is UpSite TrialPro (NCD 310.1 coverage analysis, schedule-of-assessments budget grids, free Basic tier). Its benchmarks come from executed budgets and negotiated rates.
- **Design-stage tools** price a study from a digital protocol for sponsors. Evinova states cost per visit and per patient. Faro states it can "generate site budgets in minutes" from its own cost data.

**The gap.** None of the 20 products reviewed says publicly that it prices budget lines from the CMS fee schedules at a site's Medicare locality. CMS's own free PFS Look-up Tool does give that price one code at a time. None of the 20 says it reports what share of a budget is anchored to public rates, or explains a price gap between two sites by Medicare's geographic adjustments.

The benchmark data the vendors describe is proprietary: blinded client contracts, contributing sponsors' data and contracted payments. Hospitals must publish their charges under CMS's Hospital Price Transparency rule, in effect since 1 Jan 2021 ("a comprehensive machine-readable file with all items and services", https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency). Even so, no reviewed product states a shared public anchor that both sides can reproduce line by line. That matches a top site complaint: 53% of site respondents in Medidata's own survey named lack of transparency into the itemized budget as their most significant concern. In WCG's 2025 survey, 73% of 611 sites named budgets and contracts as a top contributor to start-up delay.

---

## 2. Comparison matrix

**Capabilities (columns)**

1. Builds a per-patient budget from a protocol or schedule of assessments (SoA)
2. Benchmarks prices against a database
3. Coverage analysis or billing grid: routine care vs research, NCD 310.1
4. Prices procedures from Medicare fee schedules with locality adjustment
5. Checks a site's proposed budget line by line, or supports a counter-offer
6. Shows the share of the budget anchored to public rates vs negotiated
7. Explains geographic price differences between sites
8. Cross-trial or portfolio view of site or patient overlap
9. Site selection or feasibility analytics
10. Site payments
11. Contract (CTA) negotiation or redlining
12. Open, free or transparent methodology
13. Works for any therapeutic area

**Cell values.** "yes" or "partial" carries an evidence key, listed under the table. "–" means not stated publicly.

| Product (main users) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **IQVIA CTFS GrantPlan** + CTFS suite (sponsor, CRO) | yes [G1] | yes [G2] | partial [G3] | – | partial [G4] | – | partial [G5] | – | yes [G6] | yes [G7] | partial [G8] | – | yes [G9] |
| **Medidata Grants Manager** + Site Payments, Study Feasibility (sponsor, CRO; sites in negotiation) | – | yes [M1] | – | – | partial [M2] | – | partial [M3] | partial [M4] | yes [M5] | yes [M6] | – | – | partial [M7] |
| **Suvoda (Greenphire) Budgeting & Benchmarking** (sponsor, CRO; sites revise) | yes [S1] | yes [S2] | – | – | partial [S3] | – | partial [S4] | – | – | yes [S5] | – | – | – |
| **Evinova Study Designer – Cost** (sponsor study-design teams) | yes [E1] | yes [E2] | – | – | – | – | partial [E3] | – | partial [E4] | – | – | – | partial [E5] |
| **Faro** study design and workflow automation (biopharma study teams) | partial [F1] | partial [F2] | – | – | – | – | – | – | – | – | – | – | – |
| **Veeva Payments** + Veeva CTMS, Study Startup (sponsor, CRO) | – | – | – | – | – | – | – | – | yes [V1] | yes [V2] | – | – | – |
| **Ledger Run ClinRun** (sponsor, CRO) | – | – | – | – | partial [L1] | – | – | – | – | yes [L2] | yes [L3] | – | – |
| **UpSite Clinical TrialPro** (sites, sponsors, CROs) | yes [U1] | yes [U2] | yes [U3] | – | partial [U4] | – | partial [U5] | – | – | – | – | partial [U6] | partial [U7] |
| **Advarra OnCore CTMS** (AMCs, cancer centers, health systems) | partial [O1] | partial [O2] | yes [O3] | – | – | – | – | – | – | partial [O4] | – | – | – |
| **Veeva SiteVault CTMS** (sites) | partial [SV1] | – | yes [SV2] | – | – | – | – | – | – | partial [SV3] | – | partial [SV4] | – |
| **WCG eResearch (Velos) CTMS** (AMCs, hospitals, sites) | partial [VE1] | – | partial [VE2] | – | – | – | – | – | – | partial [VE3] | – | – | – |
| **Other site CTMSs: Advarra Clinical Conductor, CRIO Site CTMS, RealTime-CTMS** (sites, site networks, health systems) | – | – | – | – | – | – | – | – | – | partial [X1] | – | – | – |
| **Advarra Strategic Enablement Services** (sites; human service) | partial [A1] | – | yes [A2] | – | partial [A3] | – | – | – | – | – | – | – | – |
| **WCG site services** + ClinSphere Total Feasibility (sites; Total Feasibility is for sponsors and CROs) | partial [W1] | – | yes [W2] | – | partial [W3] | – | – | – | yes [W4] | partial [W5] | yes [W6] | – | – |
| **Huron managed services** (AMCs; also pharma and biotech) | – | – | yes [H1] | – | partial [H2] | – | – | – | – | – | partial [H3] | – | – |
| **Citeline Sitetrove** (site selection teams) | – | – | – | – | – | – | – | partial [C1] | yes [C2] | – | – | – | – |
| **Dataiku Clinical Site Intelligence** (feasibility) | – | – | – | – | – | – | – | partial [D1] | yes [D2] | – | – | partial [D3] | – |
| **TriNetX** (pharma and CROs; also providers and academic research) | – | – | – | – | – | – | – | – | yes [T1] | – | – | – | – |
| **Concord** (sponsor and site; open source) | yes [K1] | partial [K2] | yes, draft [K3] | yes [K4] | yes [K5] | yes [K6] | yes [K7] | yes [K8] | partial [K9] | **no** | **no** | yes [K10] | partial [K11] |

In the Concord row, "no" means we have not built it.

**Column totals among the 20 other products** (18 rows; the "Other site CTMSs" row covers three products):

| Column | Products stating it publicly |
|---|---|
| 4 (Medicare fee schedules with locality) | 0 |
| 6 (anchored share) | 0 |
| 7 (explains geography) | 0 as "yes"; 5 as "partial", each stating geography as a benchmark or cost dimension. None states a breakdown of a price gap between sites. |
| 8 (portfolio overlap) | 3 as "partial", each stating analysis of competing trials. A view of a sponsor's own portfolio is not stated publicly. |

**Public baseline for column 4 (not a trial product).** CMS's free PFS Look-up Tool already gives the Medicare price of a code at a given locality: "The PFS Look-Up Tool gives Medicare payment information on more than 10,000 services". Searches can run "through a specific MAC or a specific MAC locality", and "Each Medicare payment locality has a geographic practice cost index (GPCI) for the 3 components" (page modified 9 Feb 2026, https://www.cms.gov/medicare/physician-fee-schedule/search/overview). Concord does not own the lookup. It applies the lookup to every coded line of a schedule-of-assessments budget, with the source on each line.

### Cell evidence

**IQVIA CTFS GrantPlan**

- **G1.** "automatically extracts study details from protocol documents—including visit schedules, assessments, and treatments". https://www.iqvia.com/solutions/technologies/clinical-trial-financial-suite/ctfs-grantplan
  - The Feb 2026 fact sheet still lists visit-schedule automation under "Looking ahead", so this may still be rolling out.
- **G2.** "data from clients' executed contracts that is blinded and fed back into the system", plus "publicly available data that our engineers analyze and then apply our 'secret sauce'". https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/under-the-hood-of-grantplan-65-access-to-budgeting--a-qa-intelligence.pdf
  - The Feb 2026 fact sheet gives 655K finalized budgets, 38M negotiated data points and a quarterly refresh. https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/iqvia-grantplan-fact-sheet.pdf
- **G3.** "Unique U.S. Standard of Care (SOC) based on comprehensive claims data". NCD 310.1 and a site billing grid are not stated. Fact sheet (link above).
- **G4.** "the inclusion of the initial offer and upper-limit columns". The fact sheet adds "Compares to industry benchmarks and makes necessary adjustments; has visibility of previous final agreements". Q&A (link above).
- **G5.** "actual data for over 60 countries and provides country equivalent costing on over 130 countries". This is country level. Q&A (link above).
- **G6.** IQVIA Feasibility, a separate product: "Gather data to support site selection and understand patient populations" and "Assess investigator suitability with multi-sourced information and dynamic scoring". Changed from "partial" to "yes" on 17 Oct to match Medidata [M5] and Veeva [V1], which are also separate feasibility products. https://www.iqvia.com/solutions/technologies/site-suite/feasibility
- **G7.** CTFS Site Payments: "Built on a proven foundation that has processed over $15B in payments". https://www.iqvia.com/solutions/technologies/clinical-trial-financial-suite/ctfs-site-payments
- **G8.** "Contract negotiation (TES)" is a tech-enabled service. Also "(eCTA -- Coming soon with SaaS)". In-software redlining is not stated. https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/bcs2025-0879-03mar-financial-management-fact-sheet.pdf
- **G9.** "across all study phases, all therapeutic areas, and all geographies". Product page (G1).

**Medidata**

- **M1.** "3.5 M itemized codes", "11 M benchmark percentiles", "200 + geographies", "450 + contributing sponsors". https://www.medidata.com/en/study-experience/financial-management/grant-manager
- **M2.** "Negotiations stay anchored to the original budget logic, even as terms evolve." Grants Manager page (M1).
  - A 2011 release adds that sites and sponsors can "negotiate clinical trial site budgets directly online". https://www.medidata.com/en/press-releases/medidata-solutions-introduces-new-contracting-application-streamline-clinical-trial-site
- **M3.** "Benchmarks reflect procedure type, geography, and study context". The granularity is not stated. Grants Manager page (M1).
- **M4.** Study Feasibility helps teams "understand competition for patients from nearby trials". It is stated as competition from nearby trials. A view of the sponsor's own portfolio is not stated publicly. https://www.medidata.com/en/clinical-trial-products/medidata-ai/clinical-trial-analytics/
- **M5.** "Gain confidence in site selection, optimize study footprint, and expedite study planning." Same page as M4.
- **M6.** "automatically triggers payment calculations as work is completed in any Electronic Data Capture (EDC)". https://www.medidata.com/en/study-experience/financial-management/clinical-trial-payments
- **M7.** Benchmarks cut "from therapeutic area and phase to specific geographies". There is no all-therapeutic-areas statement. Grants Manager page (M1).

**Suvoda (Greenphire)**

All five keys cite https://www.suvoda.com/budgeting-benchmarking-for-clinical-trials

- **S1.** "Easily import a protocol's Schedule of Assessments from excel". This is an Excel SoA, not the protocol document.
- **S2.** "built from billions of dollars in contracted site payments, not theoretical survey data". The page also gives 70+ countries, "Updated quarterly" and "250+ proprietary research codes".
- **S3.** "Site enters revisions and simply shares back to the sponsor for additional edits and finalization".
- **S4.** "coverage across dozens of countries and regional cost variations". This describes data coverage.
- **S5.** "execute global Site Payments through a single platform and login".

**Evinova**

- **E1.** "Inline SoA metrics cost/visit and cost/patient" and "Cost is estimated right off the source the Clinical Development team used to design the study". This is a design-stage study estimate, not a site budget. https://evinova.com/PDFs/Evinova%20Study%20Designer%20-%20Cost.pdf
- **E2.** "combining your historic actuals with benchmarks" (PDF above), and "Opt in to the industry-wide Total Study Cost Benchmark updated regularly by phase and indication". https://evinova.com/sdo
- **E3.** "Reveal cost drivers at visit, patient, country, site and category level". PDF (E1).
- **E4.** "optimize patient and site allocations while adhering to company strategic limits". PDF (E1).
- **E5.** Benchmark "by phase and indication". https://evinova.com/sdo

**Faro** (farohealth.com now redirects to faro.ai)

- **F1.** "generate site budgets in minutes" and "Leverage Faro's cost data plus your internal templates to draft budgets in minutes". https://faro.ai/workflow-automation
  - The home page quotes a user who used Faro "to quantify the impacts of changes in an SoA". https://faro.ai/
  - Per-patient line structure and pricing method are not stated publicly, so this is "partial".
- **F2.** "Faro's cost data" (F1 page). The source of the cost data is not stated publicly. Design benchmarks ("Compare your study design against internal studies or Faro's library of public digital protocols") are about design, not prices. https://faro.ai/study-design
  - Pricing: not public ("Book a demo").

**Veeva Payments**

- **V1.** Veeva Study Startup, a separate product: "Feasibility surveys are sent to research sites during the site selection phase. Sites are automatically scored based on their response". https://www.veeva.com/wp-content/uploads/2025/10/Veeva-Product-Sheet-Clinical-Operations.pdf
- **V2.** "Payments manages reimbursements to research sites and tracks study budgets." The Oct 2025 product sheet (V1) lists it as Status "Early", 11–50 customers, "Requires CTMS".
  - Column 1 is "–" because fee schedules are set up by hand: "Payment specialists define fee schedules". https://www.veeva.com/eu/resources/veeva-payments-product-brief/

**Ledger Run ClinRun**

- **L1.** "Draft, negotiate, and finalize Clinical Trial Agreements (CTA), detailed site budgets, and associated study startup contracts." https://www.ledgerrun.com/
- **L2.** "Seamlessly manage, add, and modify site payments from initial budget to study close". https://www.ledgerrun.com/platform
- **L3.** "Review and redline contracts directly within Ledger Run". https://www.ledgerrun.com/platform

**UpSite Clinical TrialPro**

- **U1.** "Auto-generate budget grids from Schedule of Assessments". https://upsiteclinical.com/sites
  - The sponsor page adds "Move seamlessly from protocol to study-level budget, then cascade to country and site-level budgets in a single workflow". https://upsiteclinical.com/sponsors-cros
- **U2.** "Benchmarks based on real executed budgets plus sites' own historical negotiated rates". https://upsiteclinical.com/sponsors-cros
- **U3.** The software "maps each budget line item against relevant NCDs, LCDs, LCAs", and "Every recommendation is traceable to the specific coverage determination or guideline that informed it". https://upsiteclinical.com/coverage-analysis
- **U4.** "Professional exports for sponsor review" and a "Streamlined path to contract negotiation". https://upsiteclinical.com/sites
  - Column 4 is "–": the page says procedures are "mapped to CPT and Research Codes", but no fee-schedule or locality pricing is stated.
- **U5.** "Benchmarks based on therapeutic area, phase, site location, size, and type". https://upsiteclinical.com/sites
- **U6.** The Basic plan is "Free". The Professional plan says "Contact sales for pricing". The benchmark method is not published. https://upsiteclinical.com/sites
- **U7.** Benchmarks are by "therapeutic area, phase". U5 page.

**Advarra OnCore**

- **O1.** Calendar lines are "pulled from the Protocol using Sponsor's terminology", each priced by CPT code in the chargemaster. At CU Anschutz the budget is then finished in Excel. https://research.cuanschutz.edu/crs/training-education/additional-resources/clinical-trials-budgeting/how-does-oncore-fit-in/subject-related-cost-budget
- **O2.** "Charge Retail is the fair market value of the procedure"; "Charge IND / Tier 1 is the industry-sponsored research rate". These are the institution's own chargemaster rates, not a market benchmark. https://kb.wisc.edu/smph/informatics/122601
- **O3.** A Coverage Analysis Console, and a Billing Grid with "a calendar view of all scheduled procedures and their respective designations". On this customer page a billing support team makes the designations. Whether OnCore automates the determination is not stated publicly. https://clinicalstudies.wustl.edu/oncore/clinical-research-billing-support-team/
- **O4.** "milestone-based payment terms ... invoice creation, and payment reconciliation". This is site receivables. https://trialactivation.ucsf.edu/node/66
  - Pricing: "The OnCore licensing fee is dependent upon your licensed modules and your volume of protocols." https://www.advarra.com/solutions/sites/ctms/oncore/

**Veeva SiteVault**

- **SV1.** "You cannot create a budget until a current version of the study schedule exists". Fees are typed in by hand: "Enter the negotiated base fee for each activity in the corresponding visit cell." https://sites.veevavault.help/gr/sitevault/ctms/budget-create/
- **SV2.** "Easily create, revise, and manage budgets and MCAs". Line designations are Sponsor Paid, Routine Cost and Not Billable. https://sites.veeva.com/hubfs/CTMS%20brief%202026.pdf?hsLang=en
- **SV3.** "Automated Invoicing ... based on completed visits and contract terms". SV2 brief.
- **SV4.** "free for sites with up to 20 concurrent active studies". Prices are entered by the site (SV1), so no pricing method is published. https://www.veeva.com/resources/veeva-announces-research-site-clinical-trial-management-system/

**WCG eResearch (Velos)**

- **VE1.** "There are two types of budgets available for use within Velos eResearch: Calendar Budgets, and Browser Budgets." Costs are entered by the institution. https://pennctms.pmacs.upenn.edu/velos/jsp/help/Velos_eResearch_v11_2_1_UserGuide/10_2_1_budgets.htm
- **VE2.** The Study Setup module lists "Coverage Analysis" as documentation. Whether it makes the determination itself is not stated. https://www.wcgclinical.com/technologies/eresearch-ctms/
- **VE3.** The Financial Management module lists "Milestones, AR/AP, Invoicing, Payment, and Reconciliation" (VE2 page). UT Health says sponsor payments are "reconciled in Velos". https://uthscsa.edu/research/about/directory/cto/invoicing

**Other site CTMSs** (all three are site receivables, like O4, SV3 and VE3; none of the three states coverage analysis, budget building from an SoA, or benchmarks; pricing is not public for any of them)

- **X1.**
  - Advarra Clinical Conductor: "Centralize billing and task management across sites while accommodating site-specific budgets and enrollment goals", and "Identify gaps between anticipated and realized revenue". Users are "health systems, hospitals, site networks, and individual sites". The page lists an integration with a "CRPC Billing Grid (EMR)". Whether Clinical Conductor makes coverage determinations itself is not stated publicly. https://www.advarra.com/solutions/sites/ctms/clinical-conductor/
  - CRIO Site CTMS: "Set visit or procedure-level receivables, patient stipends, and payables in different currencies" and "Generate and automatically track invoices and payment vouchers". https://clinicalresearch.io/products/site-ctms/
  - RealTime-CTMS: "Track budgets, completed visits, invoices, payments, and outstanding revenue" and "Sponsor payment tracking with invoice aging reports that flag outstanding receivables". It is for "clinical research sites, site networks, academic medical centers, sponsors, and CROs". https://realtime-eclinical.com/solutions/ctms/

**Advarra Strategic Enablement Services**

- **A1.** "Pre-built protocol calendars that integrate seamlessly with Advarra's CTMS". This is a human service: 7-day calendar build and 7-day budget setup. https://www.advarra.com/solutions/sites/strategic-enablement-services/study-startup/
- **A2.** "Coverage analysis leverages Medicare guidelines and industry best practices to evaluate protocol items and services". https://www.advarra.com/solutions/sites/strategic-enablement-services/research-billing-solution/
- **A3.** "Advarra manages the complex, time-consuming negotiation process, reducing site workload". https://www.advarra.com/?p=51748

**WCG site services**

- **W1.** "a detailed internal site budget that accounts for all your trial-related expenses, including site-specific costs". Human service, 5-day turnaround. https://www.wcgclinical.com/solutions/budget-development-negotiation/
- **W2.** "determine which procedures are potentially billable to trial participants' insurance and which should be included in the clinical trial budget". "3.6k+" analyses a year. https://www.wcgclinical.com/solutions/coverage-analysis/
- **W3.** "review, revise, and negotiate the sponsor's budget template on your behalf". W1 page.
- **W4.** ClinSphere Total Feasibility, launched Apr 2024 for sponsors and CROs: "more precise matching of sites to a study". It is built on questionnaire data. https://www.wcgclinical.com/2024/04/04/wcg-launches-total-feasibility-for-faster-more-efficient-study-planning-site-selection/
- **W5.** "billing and accounts receivable management services". https://www.wcgclinical.com/solutions/sites/
- **W6.** "efficiently review your clinical trial agreements". "1k+" contracts a year. This is a service. https://www.wcgclinical.com/solutions/contract-redline-negotiation

**Huron**

- **H1.** "Prepares Draft CA Billing Grid (BG) that lists hospital services with identifiable codes". This is a human service at Stanford. https://med.stanford.edu/rmg/resources/coverage-analysis/clinical-trials.html
  - Huron claims "14000+" coverage analyses. https://www.huronconsultinggroup.com/expertise/research-enterprise/managed-services
- **H2.** "2500+ budgets negotiated". H1 managed-services page.
- **H3.** "45" is the average number of days to finalize clinical trial agreements. H1 managed-services page.

**Citeline Sitetrove**

- **C1.** "Analyze patients being targeted by competing trials." https://www.citeline.com/en/solutions/clinical/feasibility-and-site-selection
- **C2.** "over 570,000 investigators and more than 199,000 clinical trial sites spanning 185 countries" and "Successfully conduct site selection". https://citeline.com/products-services/clinical/sitetrove

**Dataiku Clinical Site Intelligence**

All three keys cite https://www.dataiku.com/solutions/catalog/clinical-site-intelligence/

- **D1.** "combines competitive intelligence of site utilization by competing sponsors".
- **D2.** "a data driven approach to Clinical Sites Selection" and "ML for enrollment rate predictions and study similarity indexing".
- **D3.** It queries "the clinicaltrials.gov database for historical and active clinical trials". The data is public; it runs on a commercial platform and pricing is not stated.

**TriNetX**

- **T1.** "identify where eligible patients actually exist" and "See 50%+ improvement in identifying sites with eligible patient populations" (vendor claim). The data is EHR-derived: "309M+ patient lives". https://trinetx.com/who-we-serve/pharma/
  - Column 8 is "–": competing trials are not mentioned on the page. Budgets are not mentioned. Pricing: not public.

**Concord** (sources: this repository)

- **K1.** Since 17 Oct, any trial can be added by NCT ID (`backend/concord/trial_import.py`): its record and registered U.S. sites are fetched from the ClinicalTrials.gov API v2, and its schedule of assessments comes from an uploaded SoA CSV (template provided) or, failing that, a draft from the registry in which every item cites its registry field and is marked 'confirm against the protocol'. Protocol documents (PDF) are not read. Three hand-authored illustrative protocols (`concord.protocol/v1` JSON in `backend/concord/compiler/protocols/`) remain as demos:
  - NCT05800015 (fianlimab, NSCLC)
  - NCT06627647 (ARTEMIDE-Lung03, NSCLC)
  - NCT06541704 (SIENNA, geographic atrophy, eye)

  Concord does not parse protocol PDFs; the SoA comes from a CSV or the registry draft.
- **K2.** Prices come from public CMS rates only: the 2026 physician fee schedule RVU26D (17,190 codes, 109 localities) and the 2026 Q4 lab fee schedule (2,117 codes), in `data/ratecard.json`. Concord has no negotiated-price benchmark.
- **K3.** The routine-versus-research split under NCD 310.1 is rule-based. Each line shows its rule, and a reviewer can override it. It is labelled "not a coverage determination". Local coverage determinations and commercial payers are not modelled.
- **K4.** Physician lines use non-facility rates at the site's Medicare locality, using its GPCIs. The locality comes from a city-to-county crosswalk where one exists; otherwise it is matched by city name and labelled "check before relying on it" (`backend/concord/terms.py`). Lab lines use CLFS national limitation amounts, which are not geographically adjusted. Hospital outpatient facility fees (OPPS) are not included.
  - Sites are the trial's registered U.S. sites on ClinicalTrials.gov. An arbitrary site cannot be entered today.
  - Coded items with no amount in the loaded files are listed as unpriced ($0, flagged), not priced. In SIENNA these are three vaccine products (CPT 90734, 90620, 90677) and the uncoded visual-function tests.
- **K5.** Sites paste or upload a CSV. Each procedure line is flagged in, above or below the user-set range, with its CMS source. Non-procedure lines are flagged "needs itemized justification". A counter-proposal HTML can be exported. So far it has been demonstrated only on a synthetic sample proposal.
- **K6.** Each dollar is labelled public, proposed standard or open (`backend/concord/anchoring.py`).
  - Example: NCT05800015 at its first listed site (Arizona locality), default band. Of $6,317.69 per participant, 18.0% is anchored to public rates, 62.0% to Concord's proposed standard (coordinator time and per-visit fees) and 20.0% is open (overhead).
  - SIENNA (NCT06541704) at its default site, after the fix of 17 Oct (commit 78a033d, which counts its 20 fixed-count dosing visits in every share): $14,588.86 per participant; 25.0% public rates, 55.0% proposed standard, 20.0% open; the shares' components now add up to the total and the band range is $14,588.86-$16,864.29.
- **K7.** Two-site comparisons are split into Medicare's geographic adjustment components, and each site is placed in the distribution across all 109 Medicare localities. U.S. only.
- **K8.** This shows where a sponsor's own concurrently recruiting lung trials share registered sites and eligible patients. Example: Regeneron's two fianlimab Phase 2/3 trials (NCT05785767, NCT05800015) shared 16 registered U.S. sites (README).
  - The site overlap is an observed registry fact. The eligible-patient overlap uses hand-encoded eligibility on a synthetic population, so it is a model output, not observed patients.
  - Since 17 Oct, breast cancer (387 industry trials from the ClinicalTrials.gov API v2, own database file) shows shared registered sites and months both recruiting only, labelled "site overlap only; eligibility overlap is available for lung cancer".
- **K9.** These are historical lung site scores with an observed-outcome check: slope 0.33 for industry Phase II/III, so raw differences are overstated. They are evidence, not a forecast.
- **K10.** Concord is free and open source. Every number is sourced or labelled an assumption. Its research findings are published in the README, including negative results: coordination gains largely disappear out of sample, and "mainly at experienced sites" was withdrawn.
- **K11.** The budget engine is not tied to a therapeutic area. It prices any item whose code is in the loaded CMS files (17,190 PFS codes, 2,117 CLFS codes), and other items are listed as unpriced (K4). It has been shown on NSCLC and ophthalmology. The overlap audit and site scores cover lung trials only. Pricing is U.S. Medicare only.

### Who uses each product, data source, pricing

| Product | Users | Price data | Public pricing |
|---|---|---|---|
| IQVIA CTFS GrantPlan | Sponsors and CROs. Vendor claim: "90% of top 20 pharma companies use CTFS GrantPlan" (Feb 2026 fact sheet, https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/iqvia-grantplan-fact-sheet.pdf) | Blinded client contracts. Gaps are filled per the same fact sheet: "where actual data is insufficient, proprietary algorithms substitute benchmark costs that are updated annually" | not public |
| Medidata Grants Manager | Sponsors and CROs, with sites in negotiation | Contributing sponsors' grant data | not public |
| Suvoda Budgeting & Benchmarking | Sponsors and CROs; sites revise in a portal | Contracted site payments, 70+ countries | not public |
| Evinova Study Designer – Cost | Sponsor clinical development teams | Sponsor's historic actuals plus an industry benchmark | not public |
| Faro | Biopharma study teams (sponsors) | "Faro's cost data plus your internal templates" (F1); the source is not stated | not public |
| Veeva Payments | Sponsors and CROs | Sponsor's own CTMS and EDC; no external benchmark stated | not public |
| Ledger Run ClinRun | Sponsors and CROs. Vendor claims "3/10 of top pharma" and "18,000+ global sites supported" (https://www.ledgerrun.com/customers) | Sponsor's own templates; no benchmark stated | not public |
| UpSite TrialPro | Sites, sponsors and CROs | Executed budgets plus sites' negotiated rates | Basic free; Professional "Contact sales" |
| Advarra OnCore | AMCs, cancer centers, health systems | Institution's chargemaster | License by modules and protocol volume |
| Veeva SiteVault CTMS | Sites | Site-entered chargemaster | Free up to 20 concurrent active studies |
| Advarra Clinical Conductor, CRIO Site CTMS, RealTime-CTMS | Sites, site networks and health systems (RealTime also lists sponsors and CROs) | Site-entered receivables; no benchmark stated | not public |
| WCG Velos, WCG services, Advarra services, Huron | Sites. Huron also lists "biotech and pharmaceutical companies" as clients (https://www.huronconsultinggroup.com/expertise/research-enterprise/managed-services) | Analysts plus institution rates | not public |
| Citeline Sitetrove, Dataiku, TriNetX | Feasibility and site-selection teams | Proprietary site database / ClinicalTrials.gov / EHR network data | not public |
| CMS PFS Look-up Tool (public baseline, not a trial product) | Anyone | Medicare physician fee schedule, by code and MAC locality | Free (public CMS tool) |
| **Concord** | Sponsors and sites | Public CMS 2026 fee schedules; ClinicalTrials.gov | Free, open source |

---

## 3. What Concord does that the others do not state publicly, and the reverse

**Concord does; the 20 others do not state publicly:**

- **A public-rate price with its source on every priced line of a trial budget (column 4).** Every line priced from a CMS file cites it:
  - physician lines cite the 2026 physician fee schedule at the site's own Medicare locality;
  - lab lines cite the 2026 lab fee schedule's national amount, which is not locality-adjusted.
  - Coded items with no CMS amount are listed as unpriced and flagged (K4).
  - No reviewed trial product states this. TrialPro maps procedures to CPT codes, and WCG notes that sites may use "a percentage of Medicare rates", but neither states fee-schedule pricing.
  - The per-code lookup itself is not new: CMS's free PFS Look-up Tool gives it one code at a time (see the public baseline under the matrix). What is new is applying it across a whole schedule-of-assessments budget.
- **An anchored-share metric (column 6).** It shows how much of each per-participant dollar rests on public rates, on a labelled proposed standard, or is open to negotiation.
  - On the NSCLC demo (NCT05800015, first listed site, Arizona locality), only 18% is anchored to public rates. That is the point: it shows where negotiating effort belongs.
- **An explanation of why two sites' prices differ (column 7).** The gap is split into Medicare's geographic adjustments, with all 109 localities shown.
  - Others state geography as a benchmark or cost dimension. None states a breakdown of a gap between two sites. GrantPlan's stated geography is country level.
  - This answers the site complaint in Medidata's white paper: comparisons made "without considering ... location distinctions, and possible discrepancies in health care coverage".
- **A line-by-line check of a site's proposed budget against a stated range, with a counter-proposal export (column 5).**
  - The range is Medicare times a band the user sets (an assumption).
  - Others state negotiation workflow: IQVIA (initial-offer and upper-limit columns), Medidata, Suvoda, ClinRun, TrialPro exports, and managed services from WCG, Advarra and Huron.
  - None states an automated check against public rates.
  - Concord's check has been shown only on a synthetic sample proposal (K5).
- **An overlap audit of a sponsor's own trials from public registry data (column 8).**
  - Medidata, Citeline and Dataiku state analysis of competing trials. None states that it finds where a sponsor's own trials compete for the same sites and patients.
  - Sites and eligible patients for lung trials; breast cancer trials show shared sites only (added 17 Oct). The patient overlap is modelled on a synthetic population (K8).

**Not unique; do not claim these:**

- **Coverage grid plus budget.** TrialPro states both.
- **Free.** TrialPro Basic is free, and SiteVault is free for up to 20 concurrent active studies.
- **Medicare price lookup by locality.** CMS's PFS Look-up Tool does this for free.
- **Budget drafted from a protocol or SoA.** GrantPlan, Suvoda, Evinova, TrialPro and Faro all state a version of it.

The defensible combination is free **and** open method **and** public source per line.

**They do; Concord does not:**

- **Negotiated-price benchmarks.**
  - GrantPlan: 655K finalized budgets.
  - Medidata: 450+ sponsors.
  - Suvoda: contracted payments.
  - TrialPro: executed budgets.
  - Concord knows nothing about what sites actually accept.
- **Protocol-document ingestion.** GrantPlan states it (the Feb 2026 fact sheet lists it as "Looking ahead").
- **Budgets from a digital study design.** Evinova and Faro state it.
- **Site payments.** IQVIA, Medidata, Suvoda, Veeva and ClinRun. Site-side receivables: OnCore, SiteVault, Velos, Clinical Conductor, CRIO, RealTime.
- **CTA redlining.** ClinRun; WCG and Huron as services.
- **A CTMS system of record.** OnCore, SiteVault, Velos, Clinical Conductor, CRIO, RealTime.
- **Human-reviewed coverage analysis at volume.** WCG, Advarra, Huron.
- **Coverage beyond U.S. Medicare.** Medidata states "200 + geographies" (M1). IQVIA's fact sheet states "Geographies served 200-plus" (G2 fact sheet). Concord is U.S. Medicare only.
- **Large proprietary site, investigator or patient data for feasibility.** Citeline: 570K investigators. TriNetX: "309M+ patient lives" of EHR data.

---

## 4. Evidence of the pain (verified numbers only)

| Finding | Number | Year | Source |
|---|---|---|---|
| Budgets and contracts were the top contributor to sites' start-up timelines (respondents picked their top three). Of 611 sites: 78% in the AMC, community hospital, health system and site network group; 76% of U.S. sites. Coverage analysis on its own: 14% (18% in the AMC group). | 73% | Jul–Sep 2025 | WCG 2025 Site Challenges Report, Q16. https://www.wcgclinical.com/wp-content/uploads/2025/10/siteChallengesReport25__final.pdf |
| Share of sites starting studies in under 60 days: AMCs, hospitals, health systems and site networks vs independent sites and physician practices | 9% vs 54% | 2025 | Same report, Q15 |
| Sponsors and CROs satisfied with the data available for building investigator grant budgets (n=189). The top process was "Manual (using email and spreadsheets)". | 30% | 2023 | Greenphire 2023 survey. https://www.suvoda.com/hubfs/Greenphire%20White%20Papers%20-%20Reports/gp_2023_budgeting_and_payments_survey_FINAL.pdf |
| Sponsors and CROs who agree "lengthy budget negotiation cycles can negatively impact relationships with clinical research sites" | 93% | 2023 | Same survey |
| Site respondents whose top concern is "a lack of transparency into the itemized budget". "All the sites surveyed requested budgets at the per procedure level" (n not disclosed; vendor survey). | 53% | 2022 | Medidata white paper. https://www.medidata.com/wp-content/uploads/2024/04/Rave-Clinical-Trial-Financial-Management-Site-Budgets-White-Paper-Sept-23-1.pdf |
| SCRS ranked "Budgets & Contracts" the #1 area sites should improve. 59% of sites declined at least one contract over an unacceptable budget (derived: 41% declined none). | #1; 59% | 2024 | SCRS 2024 Global Landscape. https://sitesolutionssummit.com/wp-content/uploads/2024/11/20240927-1620-2024-Global-Landscape-V2.pdf |
| AMCs that complete a Medicare coverage analysis: 100%. Sites taking 14+ days: 62%. Sites that recover the cost from sponsors: 49%. n not disclosed. | 62% take 14+ days; 49% recover cost | 2021 | Advarra. https://www.advarra.com/blog/study-activation-survey-results-medicare-coverage-analysis/ |
| Most common AMC budget negotiation time ("over 90 days"); non-AMCs most commonly take 30–90 days | >90 days | 2021 | Advarra. https://www.advarra.com/blog/study-activation-budget-negotiation/ |
| Of 403 organizations, 11% of selected sites were never activated, "a figure that has not changed substantially in over a decade". "The primary reason cited was budgeting and contracting problems." | 11% | 2018 | Tufts CSDD START II. https://drug-dev.com/clinical-trials-inconsistencies-prevalent-in-study-start-up/ |
| Respondents who "rarely or never accept the study sponsor's initial budget proposal" (small survey, n=41) | 96% | 2024 | Goldfarb, Applied Clinical Trials. https://www.appliedclinicaltrialsonline.com/view/site-costs-clinical-research-terminology-codes |
| From 16,240 GrantPlan negotiations: median negotiation 46 days (Ph I) and 28 days (Ph III); >23% ran past 60 days; sponsors sent every site in a country the same initial offer 54% of the time | as stated | data 2010–2015 | IMS Health, Applied Clinical Trials. https://appliedclinicaltrialsonline.com/view/speeding-negotiations-investigator-sites |
| Moffitt Cancer Center paid this to resolve False Claims Act liability after self-disclosing claims to federal healthcare programs for research-study items that were not eligible for reimbursement. This is the compliance risk a coverage grid addresses. | $19,564,743 | Jan 2024 | HHS-OIG. https://oig.hhs.gov/fraud/enforcement/florida-research-hospital-agrees-to-pay-more-than-195-million-to-resolve-liability-relating-to-self-disclosure-of-improper-billing-for-clinical-trial-costs/ |
| Vendor anecdote: separating standard of care cut per-patient procedure cost from about $3,700 to $3,200 ($496 a patient), close to $250,000 across about 500 U.S. patients | ~$250K per study | c. 2018 | IQVIA GrantPlan 6.5 Q&A (sponsored). https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/under-the-hood-of-grantplan-65-access-to-budgeting--a-qa-intelligence.pdf |
| WCG lists "a percentage of Medicare rates" as one basis for site cost schedules, next to a research fee schedule, and notes "an industry trend toward using third-party vendors for budgeting and negotiation services" | qualitative | 2022 | https://www.wcgclinical.com/insights/clinical-trial-budgets-current-trends-questions-answered-part-2/ |

**Dropped as unverified:**

- "21% of sites declined a trial over budget". This looks like a misreading of SCRS's "21%+ of contracts" bucket.
- Advarra's "109-day industry average" and its "8% / 17%" uplift figures, which have no source.
- The truncated 52.5-day figure.
- CRIO's 2,200-site benchmark.

---

## 5. Recommended deliverable, positioning, judge questions

**Deliverable (one sentence).** The Concord **Anchor Sheet**: for a U.S. trial's schedule of assessments at one of its registered U.S. sites, a one-page budget in which:

- every line names its basis: the 2026 CMS fee schedule (physician fees at the site's Medicare locality, labs at the national amount), Concord's proposed standard, or open;
- the share of per-participant dollars on each basis is stated;
- the gap to a second site is explained by Medicare's geographic adjustments;
- a site's proposed budget gets a line-by-line flag, exported as a sourced counter-proposal. Coded lines are flagged in, above or below the user-set band. Other lines are flagged "needs itemized justification".

Sponsor and site can both reproduce it for free.

"Any trial" now works through an SoA CSV upload or a cited registry draft (K1); budgets from a registry draft cover only the procedures the registry names, so a real SoA is what makes them complete.

**What "any trial" needs, in order:**

1. ~~An SoA import~~ Done 17 Oct: SoA CSV upload and add-by-NCT-ID (K1). Suvoda and TrialPro also state SoA import publicly, so it is table stakes, not a differentiator.
   - A spreadsheet is the minimum.
   - CDISC's USDM is a further option. It is the open study-design standard from TransCelerate's Digital Data Flow work ("USDM enables the digitization of study timelines and activities"; "These technical standards will be open source and available for all users"; v4.0, 3 June 2025; https://www.cdisc.org/ddf).
2. ~~The SIENNA anchored-share fix (K6).~~ Done 17 Oct (commit 78a033d).
3. A third demo outside oncology and ophthalmology.
4. Let a user enter a U.S. site that is not registered on the trial, by county or ZIP to locality. Today only registered sites can be priced (K4).
5. The overlap audit and site scores extended beyond lung trials.

**30-second positioning line.**

> Trial budgets get negotiated on numbers the other side can't reproduce. Sponsors price from subscription benchmarks built on blinded grants, sites price from their own chargemaster, and each site runs its own coverage analysis. In WCG's 2025 survey, 73% of sites named budgets and contracts as a top start-up delay. Concord gives both sides one public anchor. From a protocol's schedule of assessments it drafts the routine-versus-research grid under Medicare's clinical-trial policy. It prices each coded procedure from the 2026 CMS fee schedules, with physician fees at the site's own Medicare locality and the source on every line. It shows what share of the budget that anchor actually covers, and it checks a site's proposed budget line by line. It is free and open source, and every number is sourced or labelled an assumption.

**Questions a sponsor judge would ask**

| Question | Honest answer |
|---|---|
| We already pay for GrantPlan or Medidata. Why this? | It does not replace negotiated benchmarks, and we have none. It adds a public, citable anchor that both sides can reproduce. It also explains U.S. locality differences, where GrantPlan states country-level geography. Use it next to a benchmark, not instead of one. |
| Medicare rates are below what sites charge. Isn't this a lowball? | The output is a range, not a price. The band is an explicit, adjustable assumption (default 100–150% of Medicare), and only CMS-priced lines move with it. Non-procedure lines are flagged for itemized justification, not priced down. It is decision support, not a fair-market-value opinion. |
| How much of a real budget does the public anchor cover? | On the NSCLC demo, 18% of per-participant sponsor dollars. 62% sits on our labelled proposed standard (coordinator time, per-visit fees) and 20% is overhead. Showing that split is the product. |
| Can I run my own protocol tomorrow? | Yes, as a CSV of its schedule of assessments: add the trial by NCT ID, upload the SoA (template provided), and mark routine care. Without a CSV, Concord drafts a schedule from the registry, which names only some procedures. Protocol PDFs are not read. |
| Who stands behind the coverage calls? | They are a rule-based draft under NCD 310.1, with each rule shown and a reviewer override. The site's coverage analyst confirms them. Local coverage determinations and commercial payers are not modelled. |
| Ex-U.S. sites? | Not covered. Concord is U.S. Medicare only. |
| (Regeneron) What does the overlap audit tell us? | From public registry data, your two fianlimab Phase 2/3 trials shared 16 registered U.S. sites. The eligible-patient overlap is modelled on a synthetic population, not observed patients. It covers lung trials only today. |

**Questions a site judge would ask**

| Question | Honest answer |
|---|---|
| Won't sponsors use this to push us down to Medicare? | The band is set by the user, and non-procedure lines are flagged for justification, not cut. The locality breakdown shows how much of a two-site gap comes from Medicare's own geographic adjustments, which supports higher-cost sites. |
| Does it replace our Medicare coverage analysis? | No. It is a draft grid, not a determination. The Moffitt settlement ($19.6M, 2024) shows why your analyst signs off. |
| Does it plug into OnCore or SiteVault? | No. Exports are a Markdown or HTML term sheet and an HTML counter-proposal. There is no CTMS integration. |
| Our chargemaster isn't Medicare. | Right. The proposal check shows which of your lines sit above the band and why, so you can justify them or the sponsor can widen the band. Hospitals already publish their charges under CMS's price transparency rule, but Concord does not read those files today. |
| Who keeps the rates current? | CMS publishes new files every year (the lab fee schedule every quarter). A loader script rebuilds the rate card. The lab file needs a person to accept the AMA license. |
| Is free going to last? | It is open source, so the method and code stay public and anyone can run them. Long-term hosting and maintenance: the team needs to answer this one. |

---

## 6. Sources

**Vendors**

IQVIA
- https://www.iqvia.com/solutions/technologies/clinical-trial-financial-suite/ctfs-grantplan
- https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/iqvia-grantplan-fact-sheet.pdf (Feb 2026)
- https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/under-the-hood-of-grantplan-65-access-to-budgeting--a-qa-intelligence.pdf (c. 2018)
- https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/bcs2025-0879-03mar-financial-management-fact-sheet.pdf (Apr 2025)
- https://www.iqvia.com/solutions/technologies/clinical-trial-financial-suite/ctfs-site-payments
- https://www.iqvia.com/solutions/technologies/site-suite/feasibility

Medidata
- https://www.medidata.com/en/study-experience/financial-management/grant-manager
- https://www.medidata.com/en/study-experience/financial-management/clinical-trial-payments
- https://www.medidata.com/en/clinical-trial-products/medidata-ai/clinical-trial-analytics/
- https://www.medidata.com/en/press-releases/medidata-solutions-introduces-new-contracting-application-streamline-clinical-trial-site (2011)

Suvoda
- https://www.suvoda.com/budgeting-benchmarking-for-clinical-trials

Evinova
- https://evinova.com/PDFs/Evinova%20Study%20Designer%20-%20Cost.pdf
- https://evinova.com/sdo

Faro
- https://faro.ai/
- https://faro.ai/study-design
- https://faro.ai/workflow-automation

Veeva
- https://www.veeva.com/wp-content/uploads/2025/10/Veeva-Product-Sheet-Clinical-Operations.pdf (Oct 2025)
- https://www.veeva.com/eu/resources/veeva-payments-product-brief/
- https://sites.veevavault.help/gr/sitevault/ctms/budget-create/
- https://sites.veeva.com/hubfs/CTMS%20brief%202026.pdf?hsLang=en
- https://www.veeva.com/resources/veeva-announces-research-site-clinical-trial-management-system/ (Apr 2025)

Ledger Run
- https://www.ledgerrun.com/
- https://www.ledgerrun.com/platform
- https://www.ledgerrun.com/customers

UpSite Clinical
- https://upsiteclinical.com/sites
- https://upsiteclinical.com/sponsors-cros
- https://upsiteclinical.com/coverage-analysis

Advarra
- https://www.advarra.com/solutions/sites/ctms/oncore/
- https://www.advarra.com/solutions/sites/strategic-enablement-services/study-startup/
- https://www.advarra.com/solutions/sites/strategic-enablement-services/research-billing-solution/
- https://www.advarra.com/?p=51748

Advarra OnCore customer documentation
- https://research.cuanschutz.edu/crs/training-education/additional-resources/clinical-trials-budgeting/how-does-oncore-fit-in/subject-related-cost-budget
- https://kb.wisc.edu/smph/informatics/122601
- https://clinicalstudies.wustl.edu/oncore/clinical-research-billing-support-team/
- https://trialactivation.ucsf.edu/node/66

WCG
- https://www.wcgclinical.com/solutions/coverage-analysis/
- https://www.wcgclinical.com/solutions/budget-development-negotiation/
- https://www.wcgclinical.com/solutions/contract-redline-negotiation
- https://www.wcgclinical.com/solutions/sites/
- https://www.wcgclinical.com/2024/04/04/wcg-launches-total-feasibility-for-faster-more-efficient-study-planning-site-selection/
- https://www.wcgclinical.com/technologies/eresearch-ctms/

WCG Velos customer documentation
- https://pennctms.pmacs.upenn.edu/velos/jsp/help/Velos_eResearch_v11_2_1_UserGuide/10_2_1_budgets.htm
- https://uthscsa.edu/research/about/directory/cto/invoicing

Other site CTMSs
- https://www.advarra.com/solutions/sites/ctms/clinical-conductor/
- https://clinicalresearch.io/products/site-ctms/
- https://realtime-eclinical.com/solutions/ctms/

Huron
- https://www.huronconsultinggroup.com/expertise/research-enterprise/managed-services
- https://med.stanford.edu/rmg/resources/coverage-analysis/clinical-trials.html

Citeline
- https://citeline.com/products-services/clinical/sitetrove
- https://www.citeline.com/en/solutions/clinical/feasibility-and-site-selection

Dataiku
- https://www.dataiku.com/solutions/catalog/clinical-site-intelligence/

TriNetX
- https://trinetx.com/who-we-serve/pharma/

**Public baselines and standards**

- https://www.cms.gov/medicare/physician-fee-schedule/search/overview (PFS Look-up Tool; modified Feb 2026)
- https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency (modified Sept 2026)
- https://www.cdisc.org/ddf (USDM v4.0, June 2025)

**Evidence of pain**

- https://www.wcgclinical.com/wp-content/uploads/2025/10/siteChallengesReport25__final.pdf (2025)
- https://www.suvoda.com/hubfs/Greenphire%20White%20Papers%20-%20Reports/gp_2023_budgeting_and_payments_survey_FINAL.pdf (2023)
- https://www.medidata.com/wp-content/uploads/2024/04/Rave-Clinical-Trial-Financial-Management-Site-Budgets-White-Paper-Sept-23-1.pdf (2022)
- https://sitesolutionssummit.com/wp-content/uploads/2024/11/20240927-1620-2024-Global-Landscape-V2.pdf (2024)
- https://www.advarra.com/blog/study-activation-survey-results-medicare-coverage-analysis/ (Apr 2021)
- https://www.advarra.com/blog/study-activation-budget-negotiation/ (Apr 2021)
- https://drug-dev.com/clinical-trials-inconsistencies-prevalent-in-study-start-up/ (Apr 2018)
- https://www.appliedclinicaltrialsonline.com/view/site-costs-clinical-research-terminology-codes (Sept 2024)
- https://appliedclinicaltrialsonline.com/view/speeding-negotiations-investigator-sites (Nov 2015)
- https://oig.hhs.gov/fraud/enforcement/florida-research-hospital-agrees-to-pay-more-than-195-million-to-resolve-liability-relating-to-self-disclosure-of-improper-billing-for-clinical-trial-costs/ (Jan 2024)
- https://www.wcgclinical.com/insights/clinical-trial-budgets-current-trends-questions-answered-part-2/ (Jul 2022)

**Concord (this repository)**

- `README.md`
- `backend/concord/anchoring.py`
- `backend/concord/proposal.py`
- `backend/concord/terms.py` (site locality matching, unpriced items)
- `backend/concord/compiler/protocols/*.json`
- `backend/concord/compiler/protocols/samples/NCT05800015_SYNTHETIC_site-proposal.csv`
- `data/ratecard.json`
