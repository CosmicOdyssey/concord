# Financial integrity

## Finding

Transfer conservation and bounded modeled resource arithmetic pass the independent checks. No VERIFIED SAVINGS from real operating data are established. The inputs are hypothetical USD, not negotiated prices, reimbursement authorizations, or a complete trial budget. Sponsor savings must be examined alongside hospital, insurer and participant exposure.

## Accounting equations actually implemented

Let N be remaining target; A activation/operations investment; O site operating plus monitoring; V participant research plus screening; P sponsor-attributed procedures; U unknown-responsibility contingency; S access support; D central administration. O and V use simulated active edge-months and enrollment flows in Portfolio Command.

Expected sponsor commitment = A + O + V + N(P + U) + S + D.
Sponsor cash spending = expected commitment − N U.
Conservative portfolio budget commitment replaces O with full-horizon operating/monitoring costs and V with N × maximum selected per-participant cost. All selected new activations, support, administration and procedure contingency remain included. This bounds only the entered cost scope and finite horizon, not unknown complications or treatment beyond the authored schedule.

Sponsor → hospital transfer = expected commitment − reserve − support − administration.
Insurer → hospital = N × potentially payer-covered amount.
Participant → hospital = N × specified cost sharing.
Sponsor → participant = access support.
Hospital revenue = sponsor research transfer + payer + patient payments.
Hospital resource cost = 0.8(A + O + V) + N × procedure/supply resource proxy.
Hospital contribution = revenue − resource cost.
Insurer total = conditional payments + entered administration.
Participant net specified cash exposure = cost sharing − support; unresolved exposure remains null/UNKNOWN.
Consolidated resource consumption = hospital resource cost + sponsor administration + insurer administration + support.

Transfers are entered once as matching debit/credit, so sum of party transfer balances = 0. They are not then added to the consolidated resource sum. Site operating/startup resource percentages (80%), procedure resource percentage (70%), and assumed drug-supply consumption are explicit synthetic assumptions. They are not measured hospital margins. Operations investment is grouped in activation in the current model. Patient support is assumed consumed on access resources, not evidence of a real intervention cost or benefit.

## Coverage, unknowns and units

Every priced line allocates its full modeled amount among sponsor, potential payer, patient and reserve within cent rounding. Routine coverage remains conditional and REVIEW_REQUIRED. UNKNOWN/review-dependent responsibility goes to sponsor contingency, not silently to payer or patient. Investigational supply uses an explicit reserve proxy; real acquisition/manufacturing costs remain UNKNOWN. Fixed protocol schedules are authored illustrations, and NCT05785767 uses an explicitly labeled NCT05800015 proxy. Coverage is fixed across portfolio strategies; the portfolio optimizer does not search over billing responsibility.

All monetary inputs are USD; rate units are participants/month, activation and durations are months, per-participant charges multiply remaining participants. Monetary display rounds to cents or whole dollars in the UI. Negative expenses fail schema validation; explicit zeros are allowed only where schema permits. Missing line pricing uses a labeled $75 synthetic assumption; approximate ratecard constants are not a verified CMS fee file. A missing drug contingency can be explicitly set to zero, but that cannot establish a zero drug cost. Minimum participant support is enforced.

## Reproduced counterexamples to naive savings claims

In docs/acceptance/financial-stress.json, a 10-participant procedure responsibility change from SPONSOR to PATIENT reduces sponsor cash from $184,543.30 to $182,433.30. Patient net exposure rises from $6,144.40 to $8,254.40. Hospital revenue/resource cost stay fixed, and consolidated resources remain $233,647.70. The $2,110 sponsor reduction is a cost shift, not an economic saving.

Changing the same line to UNKNOWN instead preserves commitment at $209,543.30, lowers cash but raises contingency from $25,000 to $27,110. It is not released spendable capital.

Increasing the assumed payer share from 80% to 100% raises insurer payments and lowers participant cost sharing without reducing sponsor expense or total modeled resources. No guaranteed reimbursement follows.

Another explicit synthetic case reduces assumed central administration while adding an expensive productive site. Sponsor cash falls from $556,833.30 to $257,393.30 while hospital resource costs rise from $103,867.70 to $184,315.70. Consolidated resources fall from $609,167.70 to $289,615.70 under the assumed administration reduction. A sponsor improvement and higher hospital work coexist; every party need not benefit.

## Savings classification

| Class | Acceptance finding |
|---|---|
| VERIFIED SAVINGS | None: no actual sponsor/hospital/payer operations measured |
| MODELED SAVINGS | A→B administrative reduction in a matched synthetic scenario, conditional on realized savings flag; $75,000 in the demo, with exactly zero time change |
| ASSUMPTION-DEPENDENT | 80%/70% resources, assumed payer shares, candidate productivity, support/operations effects, hypothetical rates and administration; cost-shift examples require party disclosure |
| UNSUPPORTED | Guaranteed insurer funding, measured hospital margin, total real trial budget, downstream clinical savings, or real enrollment acceleration |

## Validation and remaining limits

Independent scalar pricing and exhaustive feasibility checks cover small portfolios. Coverage partitions, transfer balances, mixed sponsor/payer procedures, UNKNOWN reserve, missing price, invalid negative costs, explicit zeros and scenario changes are tested. The source functions are backend/concord/financial.py:economics/coverage and portfolio.py:price; full raw counterfactuals are checked in.

This demonstrates arithmetic consistency within declared assumptions. It does not validate coverage policy application to a particular beneficiary, fair market value, contract compliance, accounting standards, or real payer reimbursement. Actual fee files, complete protocol, supply costs and independent hospital cost observations remain unavailable.
