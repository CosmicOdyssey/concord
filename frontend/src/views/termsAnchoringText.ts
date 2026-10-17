// Plain-language names for Medicare's three geographic adjustments (GPCIs). The technical term goes in a tooltip.
export type GpciKey = 'work' | 'pe' | 'mp'

export const GPCI_PLAIN: Record<GpciKey, { label: string; term: string }> = {
  work: { label: 'Doctor’s time', term: 'Work GPCI: the geographic practice cost index for physician work' },
  pe: { label: 'Practice costs (rent, staff, equipment)', term: 'Practice expense (PE) GPCI: the geographic practice cost index for practice expense' },
  mp: { label: 'Malpractice insurance', term: 'Malpractice (MP) GPCI: the geographic practice cost index for professional liability insurance' },
}
