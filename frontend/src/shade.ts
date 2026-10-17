// The pair-matrix shade rules, shared by the landing hero and Portfolio overlap (halfgrid.tsx draws the cells).

/** A share (0..1) as the whole percent the views print. */
export const pctInt = (x: number) => Math.round(x * 100)

/** Shade step of the larger eligible-patient share, rounded as shown: 0, under 25, under 50, under 80, 80 or more. */
export function shadeStep(share: number): 0 | 1 | 2 | 3 | 4 {
  const s = pctInt(share)
  return s === 0 ? 0 : s < 25 ? 1 : s < 50 ? 2 : s < 80 ? 3 : 4
}

/** The dot: 80% or more of one trial's eligible patients also qualify for the other (rounded as shown). */
export const highShare = (share: number) => pctInt(share) >= 80
