// Glossary for info cards (copy deck B4, verbatim). <Gloss term="..."> in components.tsx shows these on hover,
// keyboard focus or tap; the first use of a term on a page should carry its gloss.

export const GLOSSARY = {
  'held-out': { term: 'Held-out', gloss: 'Scored on data the choice never saw: sites chosen with one half of history, scored with the other.' },
  'in-sample': { term: 'In-sample', gloss: 'Scored on the same data used to make the choice. This flatters the result.' },
  'upper-bound': { term: 'Upper bound', gloss: "A ceiling. A trial has a restriction our synthetic population can't represent, so the true overlap is at most this." },
  'synthetic-population': { term: 'Synthetic population', gloss: '20,000 simulated NSCLC patients. Prevalences are rounded modeling assumptions, not patient data.' },
  'registered-site': { term: 'Registered site', gloss: 'A site listed for the trial on ClinicalTrials.gov. Being listed does not mean the site is enrolling.' },
  'scored-by-model': { term: 'Scored by our enrollment model', gloss: "Estimated with Concord's model of site enrollment rates, not measured from actual enrollment." },
  'pre-registered': { term: 'Pre-registered', gloss: 'The method was written down before the results were run.' },
  'post-hoc': { term: 'Post hoc', gloss: 'Added after seeing results. Not pre-registered.' },
  ci95: { term: '95% CI', gloss: 'The range the true value plausibly falls in.' },
  calibrated: { term: 'Calibrated (b)', gloss: 'Site scores shrunk toward the U.S. average by how well they actually predicted enrollment. b = 1 means no shrinkage.' },
  'congestion-elasticity': { term: 'Congestion elasticity', gloss: "How much a site's enrollment rate falls as overlapping competing trials rise. 0 means no slowdown." },
  'hand-encoded': { term: 'Hand-encoded', gloss: 'Eligibility criteria entered and reviewed by a person.' },
  unreviewed: {
    term: 'Unreviewed (rule-based parse)',
    gloss: 'Eligibility criteria read automatically from registry text and not yet reviewed by a person. The parse never sets the Upper bound mark.',
  },
  'routine-care': {
    term: 'Routine care',
    gloss: "Care a patient would get anyway. Billable to Medicare (NCD 310.1) or the insurer, by Concord's rules; the payer decides coverage.",
  },
  'research-only': { term: 'Research-only', gloss: 'Exists only because of the protocol. Paid by the sponsor.' },
  gpci: { term: 'Medicare locality / GPCI', gloss: "CMS's geographic practice cost index, which adjusts physician fees for local costs." },
} as const

export type GlossaryKey = keyof typeof GLOSSARY
