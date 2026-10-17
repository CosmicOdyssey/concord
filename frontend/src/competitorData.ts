// How Concord compares (landing section, LandingCompare.tsx). The data block below is generated verbatim from
// docs/competitive-landscape.md (checked 17 Oct 2026) by scripts/gen-competitor-data.mjs: 18 matrix rows covering 20
// products, 13 capabilities, every cell's mark and evidence key, each key's text and source links, the pain-evidence
// table, the section-3 lists, the method notes and the sources. The hand-written part above it only chooses what the
// Simple view shows and gives each column a short label; it adds no claim. "–" (none) means not stated publicly, not
// that the product lacks it; "no" is used only in Concord's own row and means we have not built it.

/** yes / partial carry an evidence key; none is the document's "–" (not stated publicly); no is Concord-only. */
export type Mark = 'yes' | 'partial' | 'none' | 'no'

export interface Cell {
  mark: Mark
  key?: string
  /** "draft" or "lung only" in Concord's row ("yes, draft", "yes, lung only"). */
  qualifier?: string
}

export interface Row {
  id: string
  /** The row's bold name in the document. */
  name: string
  /** Companion products named after the "+" (or a gloss), as in the document. */
  extra: string
  /** Main users, the row's parenthetical. */
  users: string
  /** Products the row covers: one, except the "Other site CTMSs" row (three). */
  members: string[]
  cells: Cell[]
}

export interface Evidence {
  key: string
  /** Row id. */
  product: string
  /** The key's text in the document, verbatim, one entry per paragraph or sub-bullet (URLs moved to links). */
  paras: string[]
  /** Source URLs: those on the key's lines, then any it refers to ("link above", "PDF (E1)", a group-wide URL). */
  links: string[]
  groupNote?: string
}

export interface ListItem {
  lead?: string
  text: string
  subs?: ListItem[]
}

export interface PainRow {
  finding: string
  number: string
  year: string
  source: string
  url: string
}

export interface SourceSection {
  title: string
  groups: { title: string; items: { url?: string; path?: string; note?: string }[] }[]
}

/** When the document's vendor pages were checked. */
export const CHECKED = '17 Oct 2026'

/** Concord's own row cites this repository; its cards link to the document on GitHub. */
export const CONCORD_DOC_URL = 'https://github.com/CosmicOdyssey/concord/blob/main/docs/competitive-landscape.md'

/** Short column labels for the matrix heads. The document's full capability names are listed under the matrix (the
 *  legend's column list, in Simple and Detailed) and in each head's title tooltip. */
export const CAPABILITY_SHORT: Record<number, string> = {
  1: 'Per-patient budget from a protocol or SoA',
  2: 'Benchmarks prices against a database',
  3: 'Coverage analysis or billing grid (NCD 310.1)',
  4: 'Medicare fee-schedule prices with locality adjustment',
  5: 'Checks a site’s proposed budget line by line',
  6: 'Share of the budget anchored to public rates',
  7: 'Explains geographic price differences between sites',
  8: 'Cross-trial or portfolio overlap',
  9: 'Site selection or feasibility analytics',
  10: 'Site payments',
  11: 'Contract (CTA) negotiation or redlining',
  12: 'Open, free or transparent methodology',
  13: 'Works for any therapeutic area',
}

/** Simple: eight representative products (sponsor benchmarks, design-stage pricing, site CTMSs, a site service, and the
 *  one product that states both coverage analysis and benchmarked budgeting), and six columns. */
export const SIMPLE_PRODUCTS = ['iqvia', 'medidata', 'suvoda', 'upsite', 'oncore', 'sitevault', 'wcg-services', 'evinova'] as const
export const SIMPLE_COLUMNS = [1, 2, 3, 4, 6, 7] as const

/** Simple's short product names. */
export const SHORT_NAME: Record<string, string> = {
  iqvia: 'IQVIA GrantPlan',
  medidata: 'Medidata Grants Manager',
  suvoda: 'Suvoda (Greenphire)',
  evinova: 'Evinova',
  faro: 'Faro',
  'veeva-payments': 'Veeva Payments',
  'ledger-run': 'Ledger Run ClinRun',
  upsite: 'UpSite TrialPro',
  oncore: 'Advarra OnCore',
  sitevault: 'Veeva SiteVault',
  velos: 'WCG Velos',
  'other-ctms': 'Other site CTMSs',
  'advarra-services': 'Advarra services',
  'wcg-services': 'WCG services',
  huron: 'Huron',
  citeline: 'Citeline Sitetrove',
  dataiku: 'Dataiku',
  trinetx: 'TriNetX',
  concord: 'Concord',
}

/** Simple's three pain numbers. Each `text` is a verbatim phrase of the document; the source is that PAIN row. */
export const SIMPLE_PAIN = [
  { number: '73%', text: 'of 611 sites named budgets and contracts as a top contributor to start-up delay', row: (p: PainRow) => p.number === '73%' },
  {
    number: '53%',
    text: 'of site respondents in Medidata’s own survey named lack of transparency into the itemized budget as their most significant concern',
    row: (p: PainRow) => p.number === '53%',
  },
  {
    number: '59%',
    text: 'of sites declined at least one contract over an unacceptable budget (derived: 41% declined none)',
    row: (p: PainRow) => p.number === '#1; 59%',
  },
] as const

/** Simple's "What they have that we don't" line: these leads of the document's "They do; Concord does not" list. */
export const SIMPLE_THEY_DO = [
  'Negotiated-price benchmarks.',
  'Protocol-document ingestion.',
  'SoA spreadsheet import.',
  'Site payments.',
  'CTA redlining.',
  'A CTMS system of record.',
  'Coverage beyond U.S. Medicare.',
] as const

// BEGIN GENERATED by scripts/gen-competitor-data.mjs from docs/competitive-landscape.md. Do not edit by hand.
export const DOC_NOTES = {
  "prepared": "Prepared 17 Oct 2026 for the Concord pitch (HackHarvard 2026, Regeneron track).",
  "howChecked": "A vendor sweep was followed by a separate verification pass. Corrections from that pass are applied here, and claims it could not support are dropped. On 17 Oct we fetched the pages for UpSite TrialPro, Evinova, Citeline, Dataiku and Medidata Grants Manager again, along with the WCG 2025 site survey and the Advarra coverage-analysis survey, and checked them directly.",
  "completeness": "This pass added five products: Faro, TriNetX, and three site CTMSs (Advarra Clinical Conductor, CRIO Site CTMS, RealTime-CTMS) grouped in one row. It also added the free CMS PFS Look-up Tool as a public baseline for column 4. The pass ran out of web searches, so it fetched known vendor pages directly. These plausible candidates were not checked: Epic's research billing, Oracle's CTMS and site payments, Lokavant and Phesi.",
  "rule": "\"Not stated publicly\" means the vendor's public pages do not say it. It does not mean the product lacks the capability. Every vendor number below is the vendor's own claim unless a third party is named.",
  "cellValues": "\"yes\" or \"partial\" carries an evidence key, listed under the table. \"–\" means not stated publicly.",
  "concordNo": "In the Concord row, \"no\" means we have not built it.",
  "columnTotalsHead": "Column totals among the 20 other products (18 rows; the \"Other site CTMSs\" row covers three products):",
  "baseline": {
    "text": "CMS's free PFS Look-up Tool already gives the Medicare price of a code at a given locality: \"The PFS Look-Up Tool gives Medicare payment information on more than 10,000 services\". Searches can run \"through a specific MAC or a specific MAC locality\", and \"Each Medicare payment locality has a geographic practice cost index (GPCI) for the 3 components\" (page modified 9 Feb 2026). Concord does not own the lookup. It applies the lookup to every coded line of a schedule-of-assessments budget, with the source on each line.",
    "url": "https://www.cms.gov/medicare/physician-fee-schedule/search/overview"
  },
  "gap": "None of the 20 products reviewed says publicly that it prices budget lines from the CMS fee schedules at a site's Medicare locality. CMS's own free PFS Look-up Tool does give that price one code at a time. None of the 20 says it reports what share of a budget is anchored to public rates, or explains a price gap between two sites by Medicare's geographic adjustments."
} as const

export const CAPABILITIES_DOC: readonly { n: number; label: string }[] = [
  {
    "n": 1,
    "label": "Builds a per-patient budget from a protocol or schedule of assessments (SoA)"
  },
  {
    "n": 2,
    "label": "Benchmarks prices against a database"
  },
  {
    "n": 3,
    "label": "Coverage analysis or billing grid: routine care vs research, NCD 310.1"
  },
  {
    "n": 4,
    "label": "Prices procedures from Medicare fee schedules with locality adjustment"
  },
  {
    "n": 5,
    "label": "Checks a site's proposed budget line by line, or supports a counter-offer"
  },
  {
    "n": 6,
    "label": "Shows the share of the budget anchored to public rates vs negotiated"
  },
  {
    "n": 7,
    "label": "Explains geographic price differences between sites"
  },
  {
    "n": 8,
    "label": "Cross-trial or portfolio view of site or patient overlap"
  },
  {
    "n": 9,
    "label": "Site selection or feasibility analytics"
  },
  {
    "n": 10,
    "label": "Site payments"
  },
  {
    "n": 11,
    "label": "Contract (CTA) negotiation or redlining"
  },
  {
    "n": 12,
    "label": "Open, free or transparent methodology"
  },
  {
    "n": 13,
    "label": "Works for any therapeutic area"
  }
]

export const ROWS: readonly Row[] = [
  {
    "id": "iqvia",
    "name": "IQVIA CTFS GrantPlan",
    "extra": "+ CTFS suite",
    "users": "sponsor, CRO",
    "members": [
      "IQVIA CTFS GrantPlan"
    ],
    "cells": [
      {
        "mark": "yes",
        "key": "G1"
      },
      {
        "mark": "yes",
        "key": "G2"
      },
      {
        "mark": "partial",
        "key": "G3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "G4"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "G5"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "G6"
      },
      {
        "mark": "yes",
        "key": "G7"
      },
      {
        "mark": "partial",
        "key": "G8"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "G9"
      }
    ]
  },
  {
    "id": "medidata",
    "name": "Medidata Grants Manager",
    "extra": "+ Site Payments, Study Feasibility",
    "users": "sponsor, CRO; sites in negotiation",
    "members": [
      "Medidata Grants Manager"
    ],
    "cells": [
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "M1"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "M2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "M3"
      },
      {
        "mark": "partial",
        "key": "M4"
      },
      {
        "mark": "yes",
        "key": "M5"
      },
      {
        "mark": "yes",
        "key": "M6"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "M7"
      }
    ]
  },
  {
    "id": "suvoda",
    "name": "Suvoda (Greenphire) Budgeting & Benchmarking",
    "extra": "",
    "users": "sponsor, CRO; sites revise",
    "members": [
      "Suvoda (Greenphire) Budgeting & Benchmarking"
    ],
    "cells": [
      {
        "mark": "yes",
        "key": "S1"
      },
      {
        "mark": "yes",
        "key": "S2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "S3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "S4"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "S5"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "evinova",
    "name": "Evinova Study Designer – Cost",
    "extra": "",
    "users": "sponsor study-design teams",
    "members": [
      "Evinova Study Designer – Cost"
    ],
    "cells": [
      {
        "mark": "yes",
        "key": "E1"
      },
      {
        "mark": "yes",
        "key": "E2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "E3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "E4"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "E5"
      }
    ]
  },
  {
    "id": "faro",
    "name": "Faro",
    "extra": "study design and workflow automation",
    "users": "biopharma study teams",
    "members": [
      "Faro"
    ],
    "cells": [
      {
        "mark": "partial",
        "key": "F1"
      },
      {
        "mark": "partial",
        "key": "F2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "veeva-payments",
    "name": "Veeva Payments",
    "extra": "+ Veeva CTMS, Study Startup",
    "users": "sponsor, CRO",
    "members": [
      "Veeva Payments"
    ],
    "cells": [
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "V1"
      },
      {
        "mark": "yes",
        "key": "V2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "ledger-run",
    "name": "Ledger Run ClinRun",
    "extra": "",
    "users": "sponsor, CRO",
    "members": [
      "Ledger Run ClinRun"
    ],
    "cells": [
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "L1"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "L2"
      },
      {
        "mark": "yes",
        "key": "L3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "upsite",
    "name": "UpSite Clinical TrialPro",
    "extra": "",
    "users": "sites, sponsors, CROs",
    "members": [
      "UpSite Clinical TrialPro"
    ],
    "cells": [
      {
        "mark": "yes",
        "key": "U1"
      },
      {
        "mark": "yes",
        "key": "U2"
      },
      {
        "mark": "yes",
        "key": "U3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "U4"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "U5"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "U6"
      },
      {
        "mark": "partial",
        "key": "U7"
      }
    ]
  },
  {
    "id": "oncore",
    "name": "Advarra OnCore CTMS",
    "extra": "",
    "users": "AMCs, cancer centers, health systems",
    "members": [
      "Advarra OnCore CTMS"
    ],
    "cells": [
      {
        "mark": "partial",
        "key": "O1"
      },
      {
        "mark": "partial",
        "key": "O2"
      },
      {
        "mark": "yes",
        "key": "O3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "O4"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "sitevault",
    "name": "Veeva SiteVault CTMS",
    "extra": "",
    "users": "sites",
    "members": [
      "Veeva SiteVault CTMS"
    ],
    "cells": [
      {
        "mark": "partial",
        "key": "SV1"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "SV2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "SV3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "SV4"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "velos",
    "name": "WCG eResearch (Velos) CTMS",
    "extra": "",
    "users": "AMCs, hospitals, sites",
    "members": [
      "WCG eResearch (Velos) CTMS"
    ],
    "cells": [
      {
        "mark": "partial",
        "key": "VE1"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "VE2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "VE3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "other-ctms",
    "name": "Other site CTMSs: Advarra Clinical Conductor, CRIO Site CTMS, RealTime-CTMS",
    "extra": "",
    "users": "sites, site networks, health systems",
    "members": [
      "Advarra Clinical Conductor",
      "CRIO Site CTMS",
      "RealTime-CTMS"
    ],
    "cells": [
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "X1"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "advarra-services",
    "name": "Advarra Strategic Enablement Services",
    "extra": "",
    "users": "sites; human service",
    "members": [
      "Advarra Strategic Enablement Services"
    ],
    "cells": [
      {
        "mark": "partial",
        "key": "A1"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "A2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "A3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "wcg-services",
    "name": "WCG site services",
    "extra": "+ ClinSphere Total Feasibility",
    "users": "sites; Total Feasibility is for sponsors and CROs",
    "members": [
      "WCG site services"
    ],
    "cells": [
      {
        "mark": "partial",
        "key": "W1"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "W2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "W3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "W4"
      },
      {
        "mark": "partial",
        "key": "W5"
      },
      {
        "mark": "yes",
        "key": "W6"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "huron",
    "name": "Huron managed services",
    "extra": "",
    "users": "AMCs; also pharma and biotech",
    "members": [
      "Huron managed services"
    ],
    "cells": [
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "H1"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "H2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "H3"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "citeline",
    "name": "Citeline Sitetrove",
    "extra": "",
    "users": "site selection teams",
    "members": [
      "Citeline Sitetrove"
    ],
    "cells": [
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "C1"
      },
      {
        "mark": "yes",
        "key": "C2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "dataiku",
    "name": "Dataiku Clinical Site Intelligence",
    "extra": "",
    "users": "feasibility",
    "members": [
      "Dataiku Clinical Site Intelligence"
    ],
    "cells": [
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "D1"
      },
      {
        "mark": "yes",
        "key": "D2"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "partial",
        "key": "D3"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "trinetx",
    "name": "TriNetX",
    "extra": "",
    "users": "pharma and CROs; also providers and academic research",
    "members": [
      "TriNetX"
    ],
    "cells": [
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "yes",
        "key": "T1"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      },
      {
        "mark": "none"
      }
    ]
  },
  {
    "id": "concord",
    "name": "Concord",
    "extra": "",
    "users": "sponsor and site; open source",
    "members": [
      "Concord"
    ],
    "cells": [
      {
        "mark": "partial",
        "key": "K1"
      },
      {
        "mark": "partial",
        "key": "K2"
      },
      {
        "mark": "yes",
        "qualifier": "draft",
        "key": "K3"
      },
      {
        "mark": "yes",
        "key": "K4"
      },
      {
        "mark": "yes",
        "key": "K5"
      },
      {
        "mark": "yes",
        "key": "K6"
      },
      {
        "mark": "yes",
        "key": "K7"
      },
      {
        "mark": "yes",
        "qualifier": "lung only",
        "key": "K8"
      },
      {
        "mark": "partial",
        "key": "K9"
      },
      {
        "mark": "no"
      },
      {
        "mark": "no"
      },
      {
        "mark": "yes",
        "key": "K10"
      },
      {
        "mark": "partial",
        "key": "K11"
      }
    ]
  }
]

export const EVIDENCE: readonly Evidence[] = [
  {
    "key": "G1",
    "product": "iqvia",
    "paras": [
      "\"automatically extracts study details from protocol documents—including visit schedules, assessments, and treatments\".",
      "The Feb 2026 fact sheet still lists visit-schedule automation under \"Looking ahead\", so this may still be rolling out."
    ],
    "links": [
      "https://www.iqvia.com/solutions/technologies/clinical-trial-financial-suite/ctfs-grantplan"
    ]
  },
  {
    "key": "G2",
    "product": "iqvia",
    "paras": [
      "\"data from clients' executed contracts that is blinded and fed back into the system\", plus \"publicly available data that our engineers analyze and then apply our 'secret sauce'\".",
      "The Feb 2026 fact sheet gives 655K finalized budgets, 38M negotiated data points and a quarterly refresh."
    ],
    "links": [
      "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/under-the-hood-of-grantplan-65-access-to-budgeting--a-qa-intelligence.pdf",
      "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/iqvia-grantplan-fact-sheet.pdf"
    ]
  },
  {
    "key": "G3",
    "product": "iqvia",
    "paras": [
      "\"Unique U.S. Standard of Care (SOC) based on comprehensive claims data\". NCD 310.1 and a site billing grid are not stated."
    ],
    "links": [
      "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/iqvia-grantplan-fact-sheet.pdf"
    ]
  },
  {
    "key": "G4",
    "product": "iqvia",
    "paras": [
      "\"the inclusion of the initial offer and upper-limit columns\". The fact sheet adds \"Compares to industry benchmarks and makes necessary adjustments; has visibility of previous final agreements\"."
    ],
    "links": [
      "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/under-the-hood-of-grantplan-65-access-to-budgeting--a-qa-intelligence.pdf",
      "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/iqvia-grantplan-fact-sheet.pdf"
    ]
  },
  {
    "key": "G5",
    "product": "iqvia",
    "paras": [
      "\"actual data for over 60 countries and provides country equivalent costing on over 130 countries\". This is country level."
    ],
    "links": [
      "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/under-the-hood-of-grantplan-65-access-to-budgeting--a-qa-intelligence.pdf"
    ]
  },
  {
    "key": "G6",
    "product": "iqvia",
    "paras": [
      "IQVIA Feasibility, a separate product: \"Gather data to support site selection and understand patient populations\" and \"Assess investigator suitability with multi-sourced information and dynamic scoring\". Changed from \"partial\" to \"yes\" on 17 Oct to match Medidata [M5] and Veeva [V1], which are also separate feasibility products."
    ],
    "links": [
      "https://www.iqvia.com/solutions/technologies/site-suite/feasibility"
    ]
  },
  {
    "key": "G7",
    "product": "iqvia",
    "paras": [
      "CTFS Site Payments: \"Built on a proven foundation that has processed over $15B in payments\"."
    ],
    "links": [
      "https://www.iqvia.com/solutions/technologies/clinical-trial-financial-suite/ctfs-site-payments"
    ]
  },
  {
    "key": "G8",
    "product": "iqvia",
    "paras": [
      "\"Contract negotiation (TES)\" is a tech-enabled service. Also \"(eCTA -- Coming soon with SaaS)\". In-software redlining is not stated."
    ],
    "links": [
      "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/bcs2025-0879-03mar-financial-management-fact-sheet.pdf"
    ]
  },
  {
    "key": "G9",
    "product": "iqvia",
    "paras": [
      "\"across all study phases, all therapeutic areas, and all geographies\"."
    ],
    "links": [
      "https://www.iqvia.com/solutions/technologies/clinical-trial-financial-suite/ctfs-grantplan"
    ]
  },
  {
    "key": "M1",
    "product": "medidata",
    "paras": [
      "\"3.5 M itemized codes\", \"11 M benchmark percentiles\", \"200 + geographies\", \"450 + contributing sponsors\"."
    ],
    "links": [
      "https://www.medidata.com/en/study-experience/financial-management/grant-manager"
    ]
  },
  {
    "key": "M2",
    "product": "medidata",
    "paras": [
      "\"Negotiations stay anchored to the original budget logic, even as terms evolve.\"",
      "A 2011 release adds that sites and sponsors can \"negotiate clinical trial site budgets directly online\"."
    ],
    "links": [
      "https://www.medidata.com/en/study-experience/financial-management/grant-manager",
      "https://www.medidata.com/en/press-releases/medidata-solutions-introduces-new-contracting-application-streamline-clinical-trial-site"
    ]
  },
  {
    "key": "M3",
    "product": "medidata",
    "paras": [
      "\"Benchmarks reflect procedure type, geography, and study context\". The granularity is not stated."
    ],
    "links": [
      "https://www.medidata.com/en/study-experience/financial-management/grant-manager"
    ]
  },
  {
    "key": "M4",
    "product": "medidata",
    "paras": [
      "Study Feasibility helps teams \"understand competition for patients from nearby trials\". It is stated as competition from nearby trials. A view of the sponsor's own portfolio is not stated publicly."
    ],
    "links": [
      "https://www.medidata.com/en/clinical-trial-products/medidata-ai/clinical-trial-analytics/"
    ]
  },
  {
    "key": "M5",
    "product": "medidata",
    "paras": [
      "\"Gain confidence in site selection, optimize study footprint, and expedite study planning.\""
    ],
    "links": [
      "https://www.medidata.com/en/clinical-trial-products/medidata-ai/clinical-trial-analytics/"
    ]
  },
  {
    "key": "M6",
    "product": "medidata",
    "paras": [
      "\"automatically triggers payment calculations as work is completed in any Electronic Data Capture (EDC)\"."
    ],
    "links": [
      "https://www.medidata.com/en/study-experience/financial-management/clinical-trial-payments"
    ]
  },
  {
    "key": "M7",
    "product": "medidata",
    "paras": [
      "Benchmarks cut \"from therapeutic area and phase to specific geographies\". There is no all-therapeutic-areas statement."
    ],
    "links": [
      "https://www.medidata.com/en/study-experience/financial-management/grant-manager"
    ]
  },
  {
    "key": "S1",
    "product": "suvoda",
    "paras": [
      "\"Easily import a protocol's Schedule of Assessments from excel\". This is an Excel SoA, not the protocol document."
    ],
    "links": [
      "https://www.suvoda.com/budgeting-benchmarking-for-clinical-trials"
    ]
  },
  {
    "key": "S2",
    "product": "suvoda",
    "paras": [
      "\"built from billions of dollars in contracted site payments, not theoretical survey data\". The page also gives 70+ countries, \"Updated quarterly\" and \"250+ proprietary research codes\"."
    ],
    "links": [
      "https://www.suvoda.com/budgeting-benchmarking-for-clinical-trials"
    ]
  },
  {
    "key": "S3",
    "product": "suvoda",
    "paras": [
      "\"Site enters revisions and simply shares back to the sponsor for additional edits and finalization\"."
    ],
    "links": [
      "https://www.suvoda.com/budgeting-benchmarking-for-clinical-trials"
    ]
  },
  {
    "key": "S4",
    "product": "suvoda",
    "paras": [
      "\"coverage across dozens of countries and regional cost variations\". This describes data coverage."
    ],
    "links": [
      "https://www.suvoda.com/budgeting-benchmarking-for-clinical-trials"
    ]
  },
  {
    "key": "S5",
    "product": "suvoda",
    "paras": [
      "\"execute global Site Payments through a single platform and login\"."
    ],
    "links": [
      "https://www.suvoda.com/budgeting-benchmarking-for-clinical-trials"
    ]
  },
  {
    "key": "E1",
    "product": "evinova",
    "paras": [
      "\"Inline SoA metrics cost/visit and cost/patient\" and \"Cost is estimated right off the source the Clinical Development team used to design the study\". This is a design-stage study estimate, not a site budget."
    ],
    "links": [
      "https://evinova.com/PDFs/Evinova%20Study%20Designer%20-%20Cost.pdf"
    ]
  },
  {
    "key": "E2",
    "product": "evinova",
    "paras": [
      "\"combining your historic actuals with benchmarks\" (PDF above), and \"Opt in to the industry-wide Total Study Cost Benchmark updated regularly by phase and indication\"."
    ],
    "links": [
      "https://evinova.com/PDFs/Evinova%20Study%20Designer%20-%20Cost.pdf",
      "https://evinova.com/sdo"
    ]
  },
  {
    "key": "E3",
    "product": "evinova",
    "paras": [
      "\"Reveal cost drivers at visit, patient, country, site and category level\"."
    ],
    "links": [
      "https://evinova.com/PDFs/Evinova%20Study%20Designer%20-%20Cost.pdf"
    ]
  },
  {
    "key": "E4",
    "product": "evinova",
    "paras": [
      "\"optimize patient and site allocations while adhering to company strategic limits\"."
    ],
    "links": [
      "https://evinova.com/PDFs/Evinova%20Study%20Designer%20-%20Cost.pdf"
    ]
  },
  {
    "key": "E5",
    "product": "evinova",
    "paras": [
      "Benchmark \"by phase and indication\"."
    ],
    "links": [
      "https://evinova.com/sdo"
    ]
  },
  {
    "key": "F1",
    "product": "faro",
    "paras": [
      "\"generate site budgets in minutes\" and \"Leverage Faro's cost data plus your internal templates to draft budgets in minutes\".",
      "The home page quotes a user who used Faro \"to quantify the impacts of changes in an SoA\".",
      "Per-patient line structure and pricing method are not stated publicly, so this is \"partial\"."
    ],
    "links": [
      "https://faro.ai/workflow-automation",
      "https://faro.ai/"
    ],
    "groupNote": "farohealth.com now redirects to faro.ai"
  },
  {
    "key": "F2",
    "product": "faro",
    "paras": [
      "\"Faro's cost data\" (F1 page). The source of the cost data is not stated publicly. Design benchmarks (\"Compare your study design against internal studies or Faro's library of public digital protocols\") are about design, not prices.",
      "Pricing: not public (\"Book a demo\")."
    ],
    "links": [
      "https://faro.ai/workflow-automation",
      "https://faro.ai/study-design"
    ],
    "groupNote": "farohealth.com now redirects to faro.ai"
  },
  {
    "key": "V1",
    "product": "veeva-payments",
    "paras": [
      "Veeva Study Startup, a separate product: \"Feasibility surveys are sent to research sites during the site selection phase. Sites are automatically scored based on their response\"."
    ],
    "links": [
      "https://www.veeva.com/wp-content/uploads/2025/10/Veeva-Product-Sheet-Clinical-Operations.pdf"
    ]
  },
  {
    "key": "V2",
    "product": "veeva-payments",
    "paras": [
      "\"Payments manages reimbursements to research sites and tracks study budgets.\" The Oct 2025 product sheet (V1) lists it as Status \"Early\", 11–50 customers, \"Requires CTMS\".",
      "Column 1 is \"–\" because fee schedules are set up by hand: \"Payment specialists define fee schedules\"."
    ],
    "links": [
      "https://www.veeva.com/wp-content/uploads/2025/10/Veeva-Product-Sheet-Clinical-Operations.pdf",
      "https://www.veeva.com/eu/resources/veeva-payments-product-brief/"
    ]
  },
  {
    "key": "L1",
    "product": "ledger-run",
    "paras": [
      "\"Draft, negotiate, and finalize Clinical Trial Agreements (CTA), detailed site budgets, and associated study startup contracts.\""
    ],
    "links": [
      "https://www.ledgerrun.com/"
    ]
  },
  {
    "key": "L2",
    "product": "ledger-run",
    "paras": [
      "\"Seamlessly manage, add, and modify site payments from initial budget to study close\"."
    ],
    "links": [
      "https://www.ledgerrun.com/platform"
    ]
  },
  {
    "key": "L3",
    "product": "ledger-run",
    "paras": [
      "\"Review and redline contracts directly within Ledger Run\"."
    ],
    "links": [
      "https://www.ledgerrun.com/platform"
    ]
  },
  {
    "key": "U1",
    "product": "upsite",
    "paras": [
      "\"Auto-generate budget grids from Schedule of Assessments\".",
      "The sponsor page adds \"Move seamlessly from protocol to study-level budget, then cascade to country and site-level budgets in a single workflow\"."
    ],
    "links": [
      "https://upsiteclinical.com/sites",
      "https://upsiteclinical.com/sponsors-cros"
    ]
  },
  {
    "key": "U2",
    "product": "upsite",
    "paras": [
      "\"Benchmarks based on real executed budgets plus sites' own historical negotiated rates\"."
    ],
    "links": [
      "https://upsiteclinical.com/sponsors-cros"
    ]
  },
  {
    "key": "U3",
    "product": "upsite",
    "paras": [
      "The software \"maps each budget line item against relevant NCDs, LCDs, LCAs\", and \"Every recommendation is traceable to the specific coverage determination or guideline that informed it\"."
    ],
    "links": [
      "https://upsiteclinical.com/coverage-analysis"
    ]
  },
  {
    "key": "U4",
    "product": "upsite",
    "paras": [
      "\"Professional exports for sponsor review\" and a \"Streamlined path to contract negotiation\".",
      "Column 4 is \"–\": the page says procedures are \"mapped to CPT and Research Codes\", but no fee-schedule or locality pricing is stated."
    ],
    "links": [
      "https://upsiteclinical.com/sites"
    ]
  },
  {
    "key": "U5",
    "product": "upsite",
    "paras": [
      "\"Benchmarks based on therapeutic area, phase, site location, size, and type\"."
    ],
    "links": [
      "https://upsiteclinical.com/sites"
    ]
  },
  {
    "key": "U6",
    "product": "upsite",
    "paras": [
      "The Basic plan is \"Free\". The Professional plan says \"Contact sales for pricing\". The benchmark method is not published."
    ],
    "links": [
      "https://upsiteclinical.com/sites"
    ]
  },
  {
    "key": "U7",
    "product": "upsite",
    "paras": [
      "Benchmarks are by \"therapeutic area, phase\"."
    ],
    "links": [
      "https://upsiteclinical.com/sites"
    ]
  },
  {
    "key": "O1",
    "product": "oncore",
    "paras": [
      "Calendar lines are \"pulled from the Protocol using Sponsor's terminology\", each priced by CPT code in the chargemaster. At CU Anschutz the budget is then finished in Excel."
    ],
    "links": [
      "https://research.cuanschutz.edu/crs/training-education/additional-resources/clinical-trials-budgeting/how-does-oncore-fit-in/subject-related-cost-budget"
    ]
  },
  {
    "key": "O2",
    "product": "oncore",
    "paras": [
      "\"Charge Retail is the fair market value of the procedure\"; \"Charge IND / Tier 1 is the industry-sponsored research rate\". These are the institution's own chargemaster rates, not a market benchmark."
    ],
    "links": [
      "https://kb.wisc.edu/smph/informatics/122601"
    ]
  },
  {
    "key": "O3",
    "product": "oncore",
    "paras": [
      "A Coverage Analysis Console, and a Billing Grid with \"a calendar view of all scheduled procedures and their respective designations\". On this customer page a billing support team makes the designations. Whether OnCore automates the determination is not stated publicly."
    ],
    "links": [
      "https://clinicalstudies.wustl.edu/oncore/clinical-research-billing-support-team/"
    ]
  },
  {
    "key": "O4",
    "product": "oncore",
    "paras": [
      "\"milestone-based payment terms ... invoice creation, and payment reconciliation\". This is site receivables.",
      "Pricing: \"The OnCore licensing fee is dependent upon your licensed modules and your volume of protocols.\""
    ],
    "links": [
      "https://trialactivation.ucsf.edu/node/66",
      "https://www.advarra.com/solutions/sites/ctms/oncore/"
    ]
  },
  {
    "key": "SV1",
    "product": "sitevault",
    "paras": [
      "\"You cannot create a budget until a current version of the study schedule exists\". Fees are typed in by hand: \"Enter the negotiated base fee for each activity in the corresponding visit cell.\""
    ],
    "links": [
      "https://sites.veevavault.help/gr/sitevault/ctms/budget-create/"
    ]
  },
  {
    "key": "SV2",
    "product": "sitevault",
    "paras": [
      "\"Easily create, revise, and manage budgets and MCAs\". Line designations are Sponsor Paid, Routine Cost and Not Billable."
    ],
    "links": [
      "https://sites.veeva.com/hubfs/CTMS%20brief%202026.pdf?hsLang=en"
    ]
  },
  {
    "key": "SV3",
    "product": "sitevault",
    "paras": [
      "\"Automated Invoicing ... based on completed visits and contract terms\"."
    ],
    "links": [
      "https://sites.veeva.com/hubfs/CTMS%20brief%202026.pdf?hsLang=en"
    ]
  },
  {
    "key": "SV4",
    "product": "sitevault",
    "paras": [
      "\"free for sites with up to 20 concurrent active studies\". Prices are entered by the site (SV1), so no pricing method is published."
    ],
    "links": [
      "https://www.veeva.com/resources/veeva-announces-research-site-clinical-trial-management-system/"
    ]
  },
  {
    "key": "VE1",
    "product": "velos",
    "paras": [
      "\"There are two types of budgets available for use within Velos eResearch: Calendar Budgets, and Browser Budgets.\" Costs are entered by the institution."
    ],
    "links": [
      "https://pennctms.pmacs.upenn.edu/velos/jsp/help/Velos_eResearch_v11_2_1_UserGuide/10_2_1_budgets.htm"
    ]
  },
  {
    "key": "VE2",
    "product": "velos",
    "paras": [
      "The Study Setup module lists \"Coverage Analysis\" as documentation. Whether it makes the determination itself is not stated."
    ],
    "links": [
      "https://www.wcgclinical.com/technologies/eresearch-ctms/"
    ]
  },
  {
    "key": "VE3",
    "product": "velos",
    "paras": [
      "The Financial Management module lists \"Milestones, AR/AP, Invoicing, Payment, and Reconciliation\" (VE2 page). UT Health says sponsor payments are \"reconciled in Velos\"."
    ],
    "links": [
      "https://www.wcgclinical.com/technologies/eresearch-ctms/",
      "https://uthscsa.edu/research/about/directory/cto/invoicing"
    ]
  },
  {
    "key": "X1",
    "product": "other-ctms",
    "paras": [
      "Advarra Clinical Conductor: \"Centralize billing and task management across sites while accommodating site-specific budgets and enrollment goals\", and \"Identify gaps between anticipated and realized revenue\". Users are \"health systems, hospitals, site networks, and individual sites\". The page lists an integration with a \"CRPC Billing Grid (EMR)\". Whether Clinical Conductor makes coverage determinations itself is not stated publicly.",
      "CRIO Site CTMS: \"Set visit or procedure-level receivables, patient stipends, and payables in different currencies\" and \"Generate and automatically track invoices and payment vouchers\".",
      "RealTime-CTMS: \"Track budgets, completed visits, invoices, payments, and outstanding revenue\" and \"Sponsor payment tracking with invoice aging reports that flag outstanding receivables\". It is for \"clinical research sites, site networks, academic medical centers, sponsors, and CROs\"."
    ],
    "links": [
      "https://www.advarra.com/solutions/sites/ctms/clinical-conductor/",
      "https://clinicalresearch.io/products/site-ctms/",
      "https://realtime-eclinical.com/solutions/ctms/"
    ],
    "groupNote": "all three are site receivables, like O4, SV3 and VE3; none of the three states coverage analysis, budget building from an SoA, or benchmarks; pricing is not public for any of them"
  },
  {
    "key": "A1",
    "product": "advarra-services",
    "paras": [
      "\"Pre-built protocol calendars that integrate seamlessly with Advarra's CTMS\". This is a human service: 7-day calendar build and 7-day budget setup."
    ],
    "links": [
      "https://www.advarra.com/solutions/sites/strategic-enablement-services/study-startup/"
    ]
  },
  {
    "key": "A2",
    "product": "advarra-services",
    "paras": [
      "\"Coverage analysis leverages Medicare guidelines and industry best practices to evaluate protocol items and services\"."
    ],
    "links": [
      "https://www.advarra.com/solutions/sites/strategic-enablement-services/research-billing-solution/"
    ]
  },
  {
    "key": "A3",
    "product": "advarra-services",
    "paras": [
      "\"Advarra manages the complex, time-consuming negotiation process, reducing site workload\"."
    ],
    "links": [
      "https://www.advarra.com/?p=51748"
    ]
  },
  {
    "key": "W1",
    "product": "wcg-services",
    "paras": [
      "\"a detailed internal site budget that accounts for all your trial-related expenses, including site-specific costs\". Human service, 5-day turnaround."
    ],
    "links": [
      "https://www.wcgclinical.com/solutions/budget-development-negotiation/"
    ]
  },
  {
    "key": "W2",
    "product": "wcg-services",
    "paras": [
      "\"determine which procedures are potentially billable to trial participants' insurance and which should be included in the clinical trial budget\". \"3.6k+\" analyses a year."
    ],
    "links": [
      "https://www.wcgclinical.com/solutions/coverage-analysis/"
    ]
  },
  {
    "key": "W3",
    "product": "wcg-services",
    "paras": [
      "\"review, revise, and negotiate the sponsor's budget template on your behalf\"."
    ],
    "links": [
      "https://www.wcgclinical.com/solutions/budget-development-negotiation/"
    ]
  },
  {
    "key": "W4",
    "product": "wcg-services",
    "paras": [
      "ClinSphere Total Feasibility, launched Apr 2024 for sponsors and CROs: \"more precise matching of sites to a study\". It is built on questionnaire data."
    ],
    "links": [
      "https://www.wcgclinical.com/2024/04/04/wcg-launches-total-feasibility-for-faster-more-efficient-study-planning-site-selection/"
    ]
  },
  {
    "key": "W5",
    "product": "wcg-services",
    "paras": [
      "\"billing and accounts receivable management services\"."
    ],
    "links": [
      "https://www.wcgclinical.com/solutions/sites/"
    ]
  },
  {
    "key": "W6",
    "product": "wcg-services",
    "paras": [
      "\"efficiently review your clinical trial agreements\". \"1k+\" contracts a year. This is a service."
    ],
    "links": [
      "https://www.wcgclinical.com/solutions/contract-redline-negotiation"
    ]
  },
  {
    "key": "H1",
    "product": "huron",
    "paras": [
      "\"Prepares Draft CA Billing Grid (BG) that lists hospital services with identifiable codes\". This is a human service at Stanford.",
      "Huron claims \"14000+\" coverage analyses."
    ],
    "links": [
      "https://med.stanford.edu/rmg/resources/coverage-analysis/clinical-trials.html",
      "https://www.huronconsultinggroup.com/expertise/research-enterprise/managed-services"
    ]
  },
  {
    "key": "H2",
    "product": "huron",
    "paras": [
      "\"2500+ budgets negotiated\"."
    ],
    "links": [
      "https://www.huronconsultinggroup.com/expertise/research-enterprise/managed-services"
    ]
  },
  {
    "key": "H3",
    "product": "huron",
    "paras": [
      "\"45\" is the average number of days to finalize clinical trial agreements."
    ],
    "links": [
      "https://www.huronconsultinggroup.com/expertise/research-enterprise/managed-services"
    ]
  },
  {
    "key": "C1",
    "product": "citeline",
    "paras": [
      "\"Analyze patients being targeted by competing trials.\""
    ],
    "links": [
      "https://www.citeline.com/en/solutions/clinical/feasibility-and-site-selection"
    ]
  },
  {
    "key": "C2",
    "product": "citeline",
    "paras": [
      "\"over 570,000 investigators and more than 199,000 clinical trial sites spanning 185 countries\" and \"Successfully conduct site selection\"."
    ],
    "links": [
      "https://citeline.com/products-services/clinical/sitetrove"
    ]
  },
  {
    "key": "D1",
    "product": "dataiku",
    "paras": [
      "\"combines competitive intelligence of site utilization by competing sponsors\"."
    ],
    "links": [
      "https://www.dataiku.com/solutions/catalog/clinical-site-intelligence/"
    ]
  },
  {
    "key": "D2",
    "product": "dataiku",
    "paras": [
      "\"a data driven approach to Clinical Sites Selection\" and \"ML for enrollment rate predictions and study similarity indexing\"."
    ],
    "links": [
      "https://www.dataiku.com/solutions/catalog/clinical-site-intelligence/"
    ]
  },
  {
    "key": "D3",
    "product": "dataiku",
    "paras": [
      "It queries \"the clinicaltrials.gov database for historical and active clinical trials\". The data is public; it runs on a commercial platform and pricing is not stated."
    ],
    "links": [
      "https://www.dataiku.com/solutions/catalog/clinical-site-intelligence/"
    ]
  },
  {
    "key": "T1",
    "product": "trinetx",
    "paras": [
      "\"identify where eligible patients actually exist\" and \"See 50%+ improvement in identifying sites with eligible patient populations\" (vendor claim). The data is EHR-derived: \"309M+ patient lives\".",
      "Column 8 is \"–\": competing trials are not mentioned on the page. Budgets are not mentioned. Pricing: not public."
    ],
    "links": [
      "https://trinetx.com/who-we-serve/pharma/"
    ]
  },
  {
    "key": "K1",
    "product": "concord",
    "paras": [
      "The schedule of assessments is written by hand as `concord.protocol/v1` JSON (`backend/concord/compiler/protocols/`). There are three illustrative protocols built from public registry information:",
      "NCT05800015 (fianlimab, NSCLC)",
      "NCT06627647 (ARTEMIDE-Lung03, NSCLC)",
      "NCT06541704 (SIENNA, geographic atrophy, eye)",
      "Concord does not yet parse protocol PDFs or import an SoA spreadsheet."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K2",
    "product": "concord",
    "paras": [
      "Prices come from public CMS rates only: the 2026 physician fee schedule RVU26D (17,190 codes, 109 localities) and the 2026 Q4 lab fee schedule (2,117 codes), in `data/ratecard.json`. Concord has no negotiated-price benchmark."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K3",
    "product": "concord",
    "paras": [
      "The routine-versus-research split under NCD 310.1 is rule-based. Each line shows its rule, and a reviewer can override it. It is labelled \"not a coverage determination\". Local coverage determinations and commercial payers are not modelled."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K4",
    "product": "concord",
    "paras": [
      "Physician lines use non-facility rates at the site's Medicare locality, using its GPCIs. The locality comes from a city-to-county crosswalk where one exists; otherwise it is matched by city name and labelled \"check before relying on it\" (`backend/concord/terms.py`). Lab lines use CLFS national limitation amounts, which are not geographically adjusted. Hospital outpatient facility fees (OPPS) are not included.",
      "Sites are the trial's registered U.S. sites on ClinicalTrials.gov. An arbitrary site cannot be entered today.",
      "Coded items with no amount in the loaded files are listed as unpriced ($0, flagged), not priced. In SIENNA these are three vaccine products (CPT 90734, 90620, 90677) and the uncoded visual-function tests."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K5",
    "product": "concord",
    "paras": [
      "Sites paste or upload a CSV. Each procedure line is flagged in, above or below the user-set range, with its CMS source. Non-procedure lines are flagged \"needs itemized justification\". A counter-proposal HTML can be exported. So far it has been demonstrated only on a synthetic sample proposal."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K6",
    "product": "concord",
    "paras": [
      "Each dollar is labelled public, proposed standard or open (`backend/concord/anchoring.py`).",
      "Example: NCT05800015 at its first listed site (Arizona locality), default band. Of $6,317.69 per participant, 18.0% is anchored to public rates, 62.0% to Concord's proposed standard (coordinator time and per-visit fees) and 20.0% is open (overhead).",
      "SIENNA (NCT06541704) at its default site, after the fix of 17 Oct (commit 78a033d, which counts its 20 fixed-count dosing visits in every share): $14,588.86 per participant; 25.0% public rates, 55.0% proposed standard, 20.0% open; the shares' components now add up to the total and the band range is $14,588.86-$16,864.29."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K7",
    "product": "concord",
    "paras": [
      "Two-site comparisons are split into Medicare's geographic adjustment components, and each site is placed in the distribution across all 109 Medicare localities. U.S. only."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K8",
    "product": "concord",
    "paras": [
      "This shows where a sponsor's own concurrently recruiting lung trials share registered sites and eligible patients. Example: Regeneron's two fianlimab Phase 2/3 trials (NCT05785767, NCT05800015) shared 16 registered U.S. sites (README).",
      "The site overlap is an observed registry fact. The eligible-patient overlap uses hand-encoded eligibility on a synthetic population, so it is a model output, not observed patients."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K9",
    "product": "concord",
    "paras": [
      "These are historical lung site scores with an observed-outcome check: slope 0.33 for industry Phase II/III, so raw differences are overstated. They are evidence, not a forecast."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K10",
    "product": "concord",
    "paras": [
      "Concord is free and open source. Every number is sourced or labelled an assumption. Its research findings are published in the README, including negative results: coordination gains largely disappear out of sample, and \"mainly at experienced sites\" was withdrawn."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  },
  {
    "key": "K11",
    "product": "concord",
    "paras": [
      "The budget engine is not tied to a therapeutic area. It prices any item whose code is in the loaded CMS files (17,190 PFS codes, 2,117 CLFS codes), and other items are listed as unpriced (K4). It has been shown on NSCLC and ophthalmology. The overlap audit and site scores cover lung trials only. Pricing is U.S. Medicare only."
    ],
    "links": [],
    "groupNote": "sources: this repository"
  }
]

export const COLUMN_TOTALS_DOC: readonly { n: number; label: string; text: string }[] = [
  {
    "n": 4,
    "label": "Medicare fee schedules with locality",
    "text": "0"
  },
  {
    "n": 6,
    "label": "anchored share",
    "text": "0"
  },
  {
    "n": 7,
    "label": "explains geography",
    "text": "0 as \"yes\"; 5 as \"partial\", each stating geography as a benchmark or cost dimension. None states a breakdown of a price gap between sites."
  },
  {
    "n": 8,
    "label": "portfolio overlap",
    "text": "3 as \"partial\", each stating analysis of competing trials. A view of a sponsor's own portfolio is not stated publicly."
  }
]

export const DIFFERENTIATORS: readonly ListItem[] = [
  {
    "lead": "A public-rate price with its source on every priced line of a trial budget (column 4).",
    "text": "Every line priced from a CMS file cites it:",
    "subs": [
      {
        "text": "physician lines cite the 2026 physician fee schedule at the site's own Medicare locality;"
      },
      {
        "text": "lab lines cite the 2026 lab fee schedule's national amount, which is not locality-adjusted."
      },
      {
        "text": "Coded items with no CMS amount are listed as unpriced and flagged (K4)."
      },
      {
        "text": "No reviewed trial product states this. TrialPro maps procedures to CPT codes, and WCG notes that sites may use \"a percentage of Medicare rates\", but neither states fee-schedule pricing."
      },
      {
        "text": "The per-code lookup itself is not new: CMS's free PFS Look-up Tool gives it one code at a time (see the public baseline under the matrix). What is new is applying it across a whole schedule-of-assessments budget."
      }
    ]
  },
  {
    "lead": "An anchored-share metric (column 6).",
    "text": "It shows how much of each per-participant dollar rests on public rates, on a labelled proposed standard, or is open to negotiation.",
    "subs": [
      {
        "text": "On the NSCLC demo (NCT05800015, first listed site, Arizona locality), only 18% is anchored to public rates. That is the point: it shows where negotiating effort belongs."
      }
    ]
  },
  {
    "lead": "An explanation of why two sites' prices differ (column 7).",
    "text": "The gap is split into Medicare's geographic adjustments, with all 109 localities shown.",
    "subs": [
      {
        "text": "Others state geography as a benchmark or cost dimension. None states a breakdown of a gap between two sites. GrantPlan's stated geography is country level."
      },
      {
        "text": "This answers the site complaint in Medidata's white paper: comparisons made \"without considering ... location distinctions, and possible discrepancies in health care coverage\"."
      }
    ]
  },
  {
    "lead": "A line-by-line check of a site's proposed budget against a stated range, with a counter-proposal export (column 5).",
    "text": "",
    "subs": [
      {
        "text": "The range is Medicare times a band the user sets (an assumption)."
      },
      {
        "text": "Others state negotiation workflow: IQVIA (initial-offer and upper-limit columns), Medidata, Suvoda, ClinRun, TrialPro exports, and managed services from WCG, Advarra and Huron."
      },
      {
        "text": "None states an automated check against public rates."
      },
      {
        "text": "Concord's check has been shown only on a synthetic sample proposal (K5)."
      }
    ]
  },
  {
    "lead": "An overlap audit of a sponsor's own trials from public registry data (column 8).",
    "text": "",
    "subs": [
      {
        "text": "Medidata, Citeline and Dataiku state analysis of competing trials. None states that it finds where a sponsor's own trials compete for the same sites and patients."
      },
      {
        "text": "Lung only today. The patient overlap is modelled on a synthetic population (K8)."
      }
    ]
  }
]

export const NOT_UNIQUE: readonly ListItem[] = [
  {
    "lead": "Coverage grid plus budget.",
    "text": "TrialPro states both."
  },
  {
    "lead": "Free.",
    "text": "TrialPro Basic is free, and SiteVault is free for up to 20 concurrent active studies."
  },
  {
    "lead": "Medicare price lookup by locality.",
    "text": "CMS's PFS Look-up Tool does this for free."
  },
  {
    "lead": "Budget drafted from a protocol or SoA.",
    "text": "GrantPlan, Suvoda, Evinova, TrialPro and Faro all state a version of it."
  }
]

export const DEFENSIBLE = "The defensible combination is free **and** open method **and** public source per line."

export const THEY_DO: readonly ListItem[] = [
  {
    "lead": "Negotiated-price benchmarks.",
    "text": "",
    "subs": [
      {
        "text": "GrantPlan: 655K finalized budgets."
      },
      {
        "text": "Medidata: 450+ sponsors."
      },
      {
        "text": "Suvoda: contracted payments."
      },
      {
        "text": "TrialPro: executed budgets."
      },
      {
        "text": "Concord knows nothing about what sites actually accept."
      }
    ]
  },
  {
    "lead": "Protocol-document ingestion.",
    "text": "GrantPlan states it (the Feb 2026 fact sheet lists it as \"Looking ahead\")."
  },
  {
    "lead": "Budgets from a digital study design.",
    "text": "Evinova and Faro state it."
  },
  {
    "lead": "SoA spreadsheet import.",
    "text": "Suvoda and TrialPro state it.",
    "subs": [
      {
        "text": "Concord's protocols are written by hand, which is the main obstacle to \"any trial\"."
      }
    ]
  },
  {
    "lead": "Site payments.",
    "text": "IQVIA, Medidata, Suvoda, Veeva and ClinRun. Site-side receivables: OnCore, SiteVault, Velos, Clinical Conductor, CRIO, RealTime."
  },
  {
    "lead": "CTA redlining.",
    "text": "ClinRun; WCG and Huron as services."
  },
  {
    "lead": "A CTMS system of record.",
    "text": "OnCore, SiteVault, Velos, Clinical Conductor, CRIO, RealTime."
  },
  {
    "lead": "Human-reviewed coverage analysis at volume.",
    "text": "WCG, Advarra, Huron."
  },
  {
    "lead": "Coverage beyond U.S. Medicare.",
    "text": "Medidata states \"200 + geographies\" (M1). IQVIA's fact sheet states \"Geographies served 200-plus\" (G2 fact sheet). Concord is U.S. Medicare only."
  },
  {
    "lead": "Large proprietary site, investigator or patient data for feasibility.",
    "text": "Citeline: 570K investigators. TriNetX: \"309M+ patient lives\" of EHR data."
  }
]

export const PAIN: readonly PainRow[] = [
  {
    "finding": "Budgets and contracts were the top contributor to sites' start-up timelines (respondents picked their top three). Of 611 sites: 78% in the AMC, community hospital, health system and site network group; 76% of U.S. sites. Coverage analysis on its own: 14% (18% in the AMC group).",
    "number": "73%",
    "year": "Jul–Sep 2025",
    "source": "WCG 2025 Site Challenges Report, Q16.",
    "url": "https://www.wcgclinical.com/wp-content/uploads/2025/10/siteChallengesReport25__final.pdf"
  },
  {
    "finding": "Share of sites starting studies in under 60 days: AMCs, hospitals, health systems and site networks vs independent sites and physician practices",
    "number": "9% vs 54%",
    "year": "2025",
    "source": "Same report, Q15",
    "url": "https://www.wcgclinical.com/wp-content/uploads/2025/10/siteChallengesReport25__final.pdf"
  },
  {
    "finding": "Sponsors and CROs satisfied with the data available for building investigator grant budgets (n=189). The top process was \"Manual (using email and spreadsheets)\".",
    "number": "30%",
    "year": "2023",
    "source": "Greenphire 2023 survey.",
    "url": "https://www.suvoda.com/hubfs/Greenphire%20White%20Papers%20-%20Reports/gp_2023_budgeting_and_payments_survey_FINAL.pdf"
  },
  {
    "finding": "Sponsors and CROs who agree \"lengthy budget negotiation cycles can negatively impact relationships with clinical research sites\"",
    "number": "93%",
    "year": "2023",
    "source": "Same survey",
    "url": "https://www.suvoda.com/hubfs/Greenphire%20White%20Papers%20-%20Reports/gp_2023_budgeting_and_payments_survey_FINAL.pdf"
  },
  {
    "finding": "Site respondents whose top concern is \"a lack of transparency into the itemized budget\". \"All the sites surveyed requested budgets at the per procedure level\" (n not disclosed; vendor survey).",
    "number": "53%",
    "year": "2022",
    "source": "Medidata white paper.",
    "url": "https://www.medidata.com/wp-content/uploads/2024/04/Rave-Clinical-Trial-Financial-Management-Site-Budgets-White-Paper-Sept-23-1.pdf"
  },
  {
    "finding": "SCRS ranked \"Budgets & Contracts\" the #1 area sites should improve. 59% of sites declined at least one contract over an unacceptable budget (derived: 41% declined none).",
    "number": "#1; 59%",
    "year": "2024",
    "source": "SCRS 2024 Global Landscape.",
    "url": "https://sitesolutionssummit.com/wp-content/uploads/2024/11/20240927-1620-2024-Global-Landscape-V2.pdf"
  },
  {
    "finding": "AMCs that complete a Medicare coverage analysis: 100%. Sites taking 14+ days: 62%. Sites that recover the cost from sponsors: 49%. n not disclosed.",
    "number": "62% take 14+ days; 49% recover cost",
    "year": "2021",
    "source": "Advarra.",
    "url": "https://www.advarra.com/blog/study-activation-survey-results-medicare-coverage-analysis/"
  },
  {
    "finding": "Most common AMC budget negotiation time (\"over 90 days\"); non-AMCs most commonly take 30–90 days",
    "number": ">90 days",
    "year": "2021",
    "source": "Advarra.",
    "url": "https://www.advarra.com/blog/study-activation-budget-negotiation/"
  },
  {
    "finding": "Of 403 organizations, 11% of selected sites were never activated, \"a figure that has not changed substantially in over a decade\". \"The primary reason cited was budgeting and contracting problems.\"",
    "number": "11%",
    "year": "2018",
    "source": "Tufts CSDD START II.",
    "url": "https://drug-dev.com/clinical-trials-inconsistencies-prevalent-in-study-start-up/"
  },
  {
    "finding": "Respondents who \"rarely or never accept the study sponsor's initial budget proposal\" (small survey, n=41)",
    "number": "96%",
    "year": "2024",
    "source": "Goldfarb, Applied Clinical Trials.",
    "url": "https://www.appliedclinicaltrialsonline.com/view/site-costs-clinical-research-terminology-codes"
  },
  {
    "finding": "From 16,240 GrantPlan negotiations: median negotiation 46 days (Ph I) and 28 days (Ph III); >23% ran past 60 days; sponsors sent every site in a country the same initial offer 54% of the time",
    "number": "as stated",
    "year": "data 2010–2015",
    "source": "IMS Health, Applied Clinical Trials.",
    "url": "https://appliedclinicaltrialsonline.com/view/speeding-negotiations-investigator-sites"
  },
  {
    "finding": "Moffitt Cancer Center paid this to resolve False Claims Act liability after self-disclosing claims to federal healthcare programs for research-study items that were not eligible for reimbursement. This is the compliance risk a coverage grid addresses.",
    "number": "$19,564,743",
    "year": "Jan 2024",
    "source": "HHS-OIG.",
    "url": "https://oig.hhs.gov/fraud/enforcement/florida-research-hospital-agrees-to-pay-more-than-195-million-to-resolve-liability-relating-to-self-disclosure-of-improper-billing-for-clinical-trial-costs/"
  },
  {
    "finding": "Vendor anecdote: separating standard of care cut per-patient procedure cost from about $3,700 to $3,200 ($496 a patient), close to $250,000 across about 500 U.S. patients",
    "number": "~$250K per study",
    "year": "c. 2018",
    "source": "IQVIA GrantPlan 6.5 Q&A (sponsored).",
    "url": "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/under-the-hood-of-grantplan-65-access-to-budgeting--a-qa-intelligence.pdf"
  },
  {
    "finding": "WCG lists \"a percentage of Medicare rates\" as one basis for site cost schedules, next to a research fee schedule, and notes \"an industry trend toward using third-party vendors for budgeting and negotiation services\"",
    "number": "qualitative",
    "year": "2022",
    "source": "",
    "url": "https://www.wcgclinical.com/insights/clinical-trial-budgets-current-trends-questions-answered-part-2/"
  }
]

export const DROPPED: readonly string[] = [
  "\"21% of sites declined a trial over budget\". This looks like a misreading of SCRS's \"21%+ of contracts\" bucket.",
  "Advarra's \"109-day industry average\" and its \"8% / 17%\" uplift figures, which have no source.",
  "The truncated 52.5-day figure.",
  "CRIO's 2,200-site benchmark."
]

export const SOURCES: readonly SourceSection[] = [
  {
    "title": "Vendors",
    "groups": [
      {
        "title": "IQVIA",
        "items": [
          {
            "url": "https://www.iqvia.com/solutions/technologies/clinical-trial-financial-suite/ctfs-grantplan"
          },
          {
            "url": "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/iqvia-grantplan-fact-sheet.pdf",
            "note": "Feb 2026"
          },
          {
            "url": "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/under-the-hood-of-grantplan-65-access-to-budgeting--a-qa-intelligence.pdf",
            "note": "c. 2018"
          },
          {
            "url": "https://www.iqvia.com/-/media/iqvia/pdfs/library/fact-sheets/bcs2025-0879-03mar-financial-management-fact-sheet.pdf",
            "note": "Apr 2025"
          },
          {
            "url": "https://www.iqvia.com/solutions/technologies/clinical-trial-financial-suite/ctfs-site-payments"
          },
          {
            "url": "https://www.iqvia.com/solutions/technologies/site-suite/feasibility"
          }
        ]
      },
      {
        "title": "Medidata",
        "items": [
          {
            "url": "https://www.medidata.com/en/study-experience/financial-management/grant-manager"
          },
          {
            "url": "https://www.medidata.com/en/study-experience/financial-management/clinical-trial-payments"
          },
          {
            "url": "https://www.medidata.com/en/clinical-trial-products/medidata-ai/clinical-trial-analytics/"
          },
          {
            "url": "https://www.medidata.com/en/press-releases/medidata-solutions-introduces-new-contracting-application-streamline-clinical-trial-site",
            "note": "2011"
          }
        ]
      },
      {
        "title": "Suvoda",
        "items": [
          {
            "url": "https://www.suvoda.com/budgeting-benchmarking-for-clinical-trials"
          }
        ]
      },
      {
        "title": "Evinova",
        "items": [
          {
            "url": "https://evinova.com/PDFs/Evinova%20Study%20Designer%20-%20Cost.pdf"
          },
          {
            "url": "https://evinova.com/sdo"
          }
        ]
      },
      {
        "title": "Faro",
        "items": [
          {
            "url": "https://faro.ai/"
          },
          {
            "url": "https://faro.ai/study-design"
          },
          {
            "url": "https://faro.ai/workflow-automation"
          }
        ]
      },
      {
        "title": "Veeva",
        "items": [
          {
            "url": "https://www.veeva.com/wp-content/uploads/2025/10/Veeva-Product-Sheet-Clinical-Operations.pdf",
            "note": "Oct 2025"
          },
          {
            "url": "https://www.veeva.com/eu/resources/veeva-payments-product-brief/"
          },
          {
            "url": "https://sites.veevavault.help/gr/sitevault/ctms/budget-create/"
          },
          {
            "url": "https://sites.veeva.com/hubfs/CTMS%20brief%202026.pdf?hsLang=en"
          },
          {
            "url": "https://www.veeva.com/resources/veeva-announces-research-site-clinical-trial-management-system/",
            "note": "Apr 2025"
          }
        ]
      },
      {
        "title": "Ledger Run",
        "items": [
          {
            "url": "https://www.ledgerrun.com/"
          },
          {
            "url": "https://www.ledgerrun.com/platform"
          },
          {
            "url": "https://www.ledgerrun.com/customers"
          }
        ]
      },
      {
        "title": "UpSite Clinical",
        "items": [
          {
            "url": "https://upsiteclinical.com/sites"
          },
          {
            "url": "https://upsiteclinical.com/sponsors-cros"
          },
          {
            "url": "https://upsiteclinical.com/coverage-analysis"
          }
        ]
      },
      {
        "title": "Advarra",
        "items": [
          {
            "url": "https://www.advarra.com/solutions/sites/ctms/oncore/"
          },
          {
            "url": "https://www.advarra.com/solutions/sites/strategic-enablement-services/study-startup/"
          },
          {
            "url": "https://www.advarra.com/solutions/sites/strategic-enablement-services/research-billing-solution/"
          },
          {
            "url": "https://www.advarra.com/?p=51748"
          }
        ]
      },
      {
        "title": "Advarra OnCore customer documentation",
        "items": [
          {
            "url": "https://research.cuanschutz.edu/crs/training-education/additional-resources/clinical-trials-budgeting/how-does-oncore-fit-in/subject-related-cost-budget"
          },
          {
            "url": "https://kb.wisc.edu/smph/informatics/122601"
          },
          {
            "url": "https://clinicalstudies.wustl.edu/oncore/clinical-research-billing-support-team/"
          },
          {
            "url": "https://trialactivation.ucsf.edu/node/66"
          }
        ]
      },
      {
        "title": "WCG",
        "items": [
          {
            "url": "https://www.wcgclinical.com/solutions/coverage-analysis/"
          },
          {
            "url": "https://www.wcgclinical.com/solutions/budget-development-negotiation/"
          },
          {
            "url": "https://www.wcgclinical.com/solutions/contract-redline-negotiation"
          },
          {
            "url": "https://www.wcgclinical.com/solutions/sites/"
          },
          {
            "url": "https://www.wcgclinical.com/2024/04/04/wcg-launches-total-feasibility-for-faster-more-efficient-study-planning-site-selection/"
          },
          {
            "url": "https://www.wcgclinical.com/technologies/eresearch-ctms/"
          }
        ]
      },
      {
        "title": "WCG Velos customer documentation",
        "items": [
          {
            "url": "https://pennctms.pmacs.upenn.edu/velos/jsp/help/Velos_eResearch_v11_2_1_UserGuide/10_2_1_budgets.htm"
          },
          {
            "url": "https://uthscsa.edu/research/about/directory/cto/invoicing"
          }
        ]
      },
      {
        "title": "Other site CTMSs",
        "items": [
          {
            "url": "https://www.advarra.com/solutions/sites/ctms/clinical-conductor/"
          },
          {
            "url": "https://clinicalresearch.io/products/site-ctms/"
          },
          {
            "url": "https://realtime-eclinical.com/solutions/ctms/"
          }
        ]
      },
      {
        "title": "Huron",
        "items": [
          {
            "url": "https://www.huronconsultinggroup.com/expertise/research-enterprise/managed-services"
          },
          {
            "url": "https://med.stanford.edu/rmg/resources/coverage-analysis/clinical-trials.html"
          }
        ]
      },
      {
        "title": "Citeline",
        "items": [
          {
            "url": "https://citeline.com/products-services/clinical/sitetrove"
          },
          {
            "url": "https://www.citeline.com/en/solutions/clinical/feasibility-and-site-selection"
          }
        ]
      },
      {
        "title": "Dataiku",
        "items": [
          {
            "url": "https://www.dataiku.com/solutions/catalog/clinical-site-intelligence/"
          }
        ]
      },
      {
        "title": "TriNetX",
        "items": [
          {
            "url": "https://trinetx.com/who-we-serve/pharma/"
          }
        ]
      }
    ]
  },
  {
    "title": "Public baselines and standards",
    "groups": [
      {
        "title": "",
        "items": [
          {
            "url": "https://www.cms.gov/medicare/physician-fee-schedule/search/overview",
            "note": "PFS Look-up Tool; modified Feb 2026"
          },
          {
            "url": "https://www.cms.gov/priorities/key-initiatives/hospital-price-transparency",
            "note": "modified Sept 2026"
          },
          {
            "url": "https://www.cdisc.org/ddf",
            "note": "USDM v4.0, June 2025"
          }
        ]
      }
    ]
  },
  {
    "title": "Evidence of pain",
    "groups": [
      {
        "title": "",
        "items": [
          {
            "url": "https://www.wcgclinical.com/wp-content/uploads/2025/10/siteChallengesReport25__final.pdf",
            "note": "2025"
          },
          {
            "url": "https://www.suvoda.com/hubfs/Greenphire%20White%20Papers%20-%20Reports/gp_2023_budgeting_and_payments_survey_FINAL.pdf",
            "note": "2023"
          },
          {
            "url": "https://www.medidata.com/wp-content/uploads/2024/04/Rave-Clinical-Trial-Financial-Management-Site-Budgets-White-Paper-Sept-23-1.pdf",
            "note": "2022"
          },
          {
            "url": "https://sitesolutionssummit.com/wp-content/uploads/2024/11/20240927-1620-2024-Global-Landscape-V2.pdf",
            "note": "2024"
          },
          {
            "url": "https://www.advarra.com/blog/study-activation-survey-results-medicare-coverage-analysis/",
            "note": "Apr 2021"
          },
          {
            "url": "https://www.advarra.com/blog/study-activation-budget-negotiation/",
            "note": "Apr 2021"
          },
          {
            "url": "https://drug-dev.com/clinical-trials-inconsistencies-prevalent-in-study-start-up/",
            "note": "Apr 2018"
          },
          {
            "url": "https://www.appliedclinicaltrialsonline.com/view/site-costs-clinical-research-terminology-codes",
            "note": "Sept 2024"
          },
          {
            "url": "https://appliedclinicaltrialsonline.com/view/speeding-negotiations-investigator-sites",
            "note": "Nov 2015"
          },
          {
            "url": "https://oig.hhs.gov/fraud/enforcement/florida-research-hospital-agrees-to-pay-more-than-195-million-to-resolve-liability-relating-to-self-disclosure-of-improper-billing-for-clinical-trial-costs/",
            "note": "Jan 2024"
          },
          {
            "url": "https://www.wcgclinical.com/insights/clinical-trial-budgets-current-trends-questions-answered-part-2/",
            "note": "Jul 2022"
          }
        ]
      }
    ]
  },
  {
    "title": "Concord (this repository)",
    "groups": [
      {
        "title": "",
        "items": [
          {
            "path": "README.md"
          },
          {
            "path": "backend/concord/anchoring.py"
          },
          {
            "path": "backend/concord/proposal.py"
          },
          {
            "path": "backend/concord/terms.py"
          },
          {
            "path": "backend/concord/compiler/protocols/*.json"
          },
          {
            "path": "backend/concord/compiler/protocols/samples/NCT05800015_SYNTHETIC_site-proposal.csv"
          },
          {
            "path": "data/ratecard.json"
          }
        ]
      }
    ]
  }
]
// END GENERATED

// ---------------------------------------------------------------------------------------------------------------------
// Derived

export const EVIDENCE_BY_KEY: ReadonlyMap<string, Evidence> = new Map(EVIDENCE.map((e) => [e.key, e]))
export const ROW_BY_ID: ReadonlyMap<string, Row> = new Map(ROWS.map((r) => [r.id, r]))
export const CONCORD_ROW: Row = ROW_BY_ID.get('concord')!
export const COMPETITOR_ROWS: readonly Row[] = ROWS.filter((r) => r.id !== 'concord')
/** 20: the "Other site CTMSs" row covers three products. */
export const PRODUCT_COUNT = COMPETITOR_ROWS.reduce((n, r) => n + r.members.length, 0)

export const CAPABILITIES = CAPABILITIES_DOC.map((c) => ({ ...c, short: CAPABILITY_SHORT[c.n] }))

/** The quoted phrases ("...") in a key's text: the vendor's own words for competitors. */
export function quotesOf(e: Evidence): string[] {
  return e.paras.join(' ').match(/"[^"]+"/g) ?? []
}

/** Competitor rows stating a column publicly, as yes and as partial (the document's column totals). */
export function columnCount(n: number): { yes: number; partial: number } {
  let yes = 0
  let partial = 0
  for (const r of COMPETITOR_ROWS) {
    const m = r.cells[n - 1].mark
    if (m === 'yes') yes++
    else if (m === 'partial') partial++
  }
  return { yes, partial }
}

/** "iqvia.com/…/ctfs-grantplan": a readable label for a source link. */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const parts = u.pathname.split('/').filter(Boolean)
    if (!parts.length) return host
    const last = decodeURIComponent(parts.at(-1)!)
    return parts.length > 1 ? `${host}/…/${last}` : `${host}/${last}`
  } catch {
    return url
  }
}

/** A key's source links; Concord's own keys cite this repository, so they link to the document on GitHub. */
export function evidenceLinks(e: Evidence): string[] {
  return e.links.length ? e.links : [CONCORD_DOC_URL]
}

/** Simple: the one sub-point of each "Concord does" item that stays visible, because it limits the claim. */
export const SIMPLE_CAVEAT: readonly (RegExp | null)[] = [/not new/, /only 18%/, null, /synthetic sample/, /Lung only/]

export function markWord(c: Cell): string {
  if (c.mark === 'yes') return c.qualifier ? `Yes, ${c.qualifier}` : 'Yes'
  if (c.mark === 'partial') return 'Partial'
  if (c.mark === 'no') return 'No (not built)'
  return 'Not stated publicly'
}
