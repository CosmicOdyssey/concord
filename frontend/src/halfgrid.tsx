// The half pair matrix, shared by the landing hero and Portfolio overlap (Simple). A pair matrix is symmetric across its
// diagonal, so each unordered pair gets one cell: rows are trials 1..n-1, columns trials 2..n, and only the cells above
// the diagonal are drawn. Each view brings its own cell control (a plain button beside a side card, or a hover-card
// trigger), header contents and legend; the layout, cell face and shade classes are here. Shade rules: shade.ts.
import type { CSSProperties, ReactNode } from 'react'
import './halfgrid.css'

interface HalfGridProps<T> {
  items: readonly T[]
  keyOf: (t: T) => string
  /** Accessible name of the table. */
  label: string
  corner?: ReactNode
  rowHead: (t: T) => ReactNode
  /** Column header contents; wrap the label in `.hg-vt` to set it bottom to top. */
  colHead: (t: T) => ReactNode
  /** The control for one pair (`row` comes before `col` in `items`), or null to leave the slot empty. */
  cell: (row: T, col: T) => ReactNode
  className?: string
}

export function HalfGrid<T>({ items, keyOf, label, corner = 'Row × column', rowHead, colHead, cell, className }: HalfGridProps<T>) {
  const rows = items.slice(0, -1)
  const cols = items.slice(1)
  return (
    <div role="table" className={`hg${className ? ` ${className}` : ''}`} aria-label={label} style={{ '--hg-cols': cols.length } as CSSProperties}>
      <div role="row" className="hg-row">
        <div role="columnheader" className="hg-corner">
          {corner}
        </div>
        {cols.map((c) => (
          <div role="columnheader" key={keyOf(c)} className="hg-colh">
            {colHead(c)}
          </div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div role="row" className="hg-row" key={keyOf(r)}>
          <div role="rowheader" className="hg-rowh">
            {rowHead(r)}
          </div>
          {cols.map((c, j) => {
            // Column j is trial j + 1: below the diagonal (and on it) there is no cell.
            const content = j < i ? null : cell(r, c)
            return content ? (
              <div role="cell" key={keyOf(c)}>
                {content}
              </div>
            ) : (
              <div role="cell" key={keyOf(c)} className="hg-empty" />
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** What a cell shows: the shared registered sites (no number when they can't be counted: unknown, never 0), the
 *  upper-bound / unreviewed marks, and the dot for 80% or more one way. The cell's own label says it all in words. */
export function CellFace({ n, marks, hi }: { n: number | null; marks: string; hi: boolean }) {
  return (
    <>
      {n !== null && <span className="num hg-n">{n}</span>}
      <span className="hg-mk" aria-hidden="true">
        {marks}
      </span>
      {hi && <span className="hg-hi" aria-hidden="true" />}
    </>
  )
}
