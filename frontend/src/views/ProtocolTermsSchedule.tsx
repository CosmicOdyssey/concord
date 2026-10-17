// Schedule of assessments for the protocol-to-terms flow: visit timeline, coverage split and rules, visits x
// procedures grid, coverage list with reviewer toggles, and the selected-node detail. Illustrative schedules only.
import { useMemo, useState, type ReactNode } from 'react'
import { HoverCard } from '../components'
import {
  RESEARCH_LEGEND,
  ROUTINE_LEGEND,
  coverageLabel,
  formulaText,
  type Coverage,
  type Line,
  type NodeState,
  type Protocol,
  type ProtocolNode,
  type Rule,
  type Visit,
} from '../termsFlowApi'
import { usd } from '../format'

export function RuleChip({ rule, coverage, title }: { rule: string; coverage: Coverage; title?: string }) {
  return (
    <span className={`tf-rule tf-rule-${coverage}`} title={title}>
      {rule}
    </span>
  )
}

// ------------------------------------------------------------------ timeline

const X0 = 46
const X1 = 470
const D0 = -30
const D1 = 160
// Visits after cycle 8 (per-occurrence and follow-up) are spread evenly to the right of the break.
const VIEW_W = 800
const LATER_X0 = 524
const LATER_X1 = 780

function xOf(day: number): number {
  return X0 + ((day - D0) / (D1 - D0)) * (X1 - X0)
}

export function VisitTimeline({ protocol }: { protocol: Protocol }) {
  const imaging = useMemo(() => {
    const s = new Map<string, string>()
    for (const n of protocol.nodes) if (n.procedure === 'ct_chest' && n.window) s.set(n.visit, n.window.split(':')[0])
    return s
  }, [protocol])
  const timed = protocol.visits.filter((v) => v.kind === 'screening' || v.kind === 'treatment')
  const later = protocol.visits.filter((v) => v.kind === 'repeat' || v.kind === 'follow_up')
  const scr = timed.find((v) => v.kind === 'screening')
  const step = later.length > 1 ? (LATER_X1 - LATER_X0) / (later.length - 1) : 0
  const win = timed.find((v) => v.kind === 'treatment' && v.minus)?.minus
  return (
    <figure className="tf-timeline-fig">
      <div className="tf-timeline-wrap">
        <svg
          className="tf-timeline"
          viewBox={`0 0 ${VIEW_W} 120`}
          role="img"
          aria-label="Visit timeline: screening, 21-day cycles with windows, then per-occurrence and follow-up visits"
        >
          <line x1={X0 - 10} x2={X1 + 12} y1={58} y2={58} className="tf-tl-axis" />
          {scr && scr.day !== undefined && (
            <g>
              <rect x={xOf(scr.day)} y={50} width={xOf(scr.day_end ?? -1) - xOf(scr.day)} height={16} rx={4} className="tf-tl-scr" />
              <text x={(xOf(scr.day) + xOf(scr.day_end ?? -1)) / 2} y={88} className="tf-tl-label" textAnchor="middle">
                {scr.short}
              </text>
              <text x={(xOf(scr.day) + xOf(scr.day_end ?? -1)) / 2} y={103} className="tf-tl-sub" textAnchor="middle">
                d −28 to −1
              </text>
            </g>
          )}
          {timed
            .filter((v) => v.kind === 'treatment' && v.day !== undefined)
            .map((v) => {
              const x = xOf(v.day as number)
              const w = Math.max(xOf((v.day as number) + (v.plus ?? 0)) - xOf((v.day as number) - (v.minus ?? 0)), 0)
              const img = imaging.get(v.id)
              return (
                <g key={v.id}>
                  {w > 0 && <rect x={x - w / 2} y={54} width={w} height={8} rx={3} className="tf-tl-win" />}
                  <circle cx={x} cy={58} r={4.5} className="tf-tl-dot" />
                  <text x={x} y={88} className="tf-tl-label" textAnchor="middle">
                    {v.short}
                  </text>
                  <text x={x} y={103} className="tf-tl-sub" textAnchor="middle">
                    d{v.day}
                  </text>
                  {img && (
                    <g>
                      <rect x={x - 14} y={20} width={28} height={17} rx={4} className="tf-tl-img" />
                      <text x={x} y={32} className="tf-tl-imgtext" textAnchor="middle">
                        {img.replace('Week ', 'W')}
                      </text>
                      <line x1={x} x2={x} y1={37} y2={51} className="tf-tl-tick" />
                    </g>
                  )}
                </g>
              )
            })}
          <text x={497} y={62} className="tf-tl-break" textAnchor="middle">
            ⋯
          </text>
          {later.map((v, i) => {
            const x = LATER_X0 + i * step
            return (
              <g key={v.id}>
                <circle cx={x} cy={58} r={4.5} className={v.kind === 'repeat' ? 'tf-tl-rep' : 'tf-tl-dot'} />
                <text x={x} y={88} className="tf-tl-label" textAnchor="middle">
                  {v.short}
                </text>
                <text x={x} y={103} className="tf-tl-sub" textAnchor="middle">
                  {shortWindow(v)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <figcaption className="tf-timeline-key">
        <span>
          <span className="tf-key tf-key-dot" aria-hidden="true" /> Day 1 of each 21-day cycle
        </span>
        <span>
          <span className="tf-key tf-key-win" aria-hidden="true" /> {win ? `±${win}-day visit window` : 'Visit window'}
        </span>
        <span>
          <span className="tf-key tf-key-img" aria-hidden="true" /> Scheduled tumor assessment (week)
        </span>
        <span>
          <span className="tf-key tf-key-rep" aria-hidden="true" /> Repeating visit, priced per occurrence
        </span>
      </figcaption>
    </figure>
  )
}

// ------------------------------------------------------------------ coverage split and rules

/** How many scheduled items each payer covers, with the copy deck's coverage legend. */
export function CoverageSplit({ nRoutine, nResearch }: { nRoutine: number; nResearch: number }) {
  return (
    <div className="tf-split">
      <p className="tf-split-text">
        <span className="num strong">{nRoutine}</span> routine care (billable to insurance) · <span className="num strong">{nResearch}</span> research (sponsor)
      </p>
      <div className="tf-split-bar" aria-hidden="true">
        <span className="tf-split-routine" style={{ flexGrow: nRoutine }} />
        <span className="tf-split-research" style={{ flexGrow: nResearch }} />
      </div>
      <ul className="tf-split-legend">
        <li>
          <span className="tf-key tf-key-routine" aria-hidden="true" />
          <span>{ROUTINE_LEGEND}</span>
        </li>
        <li>
          <span className="tf-key tf-key-research" aria-hidden="true" />
          <span>{RESEARCH_LEGEND}</span>
        </li>
      </ul>
    </div>
  )
}

/** Rules R1-R5: id, title, who pays and how many items each labels. Simple shows the rule text in a hover card;
 *  Detailed prints it under the title. */
export function RuleList({ rules, detailed }: { rules: Rule[]; detailed: boolean }) {
  return (
    <ul className="tf-rules">
      {rules.map((r) => (
        <li key={r.id} className="tf-rule-row">
          <RuleChip rule={r.id} coverage={r.coverage} />
          <span className="tf-rule-main">
            {detailed ? (
              <span className="strong">{r.title}</span>
            ) : (
              <HoverCard
                content={
                  <>
                    <span className="hc-title">
                      {r.id}: {r.title}
                    </span>
                    {r.text}
                    <span className="hc-src">{coverageLabel(r.coverage)}</span>
                  </>
                }
              >
                {r.title}
              </HoverCard>
            )}
            <span className="tf-rule-pay">
              <span className="tf-rule-sep" aria-hidden="true">
                {' · '}
              </span>
              {r.coverage === 'research' ? 'sponsor pays' : 'billable to insurance'}
            </span>
            {detailed && <span className="tf-rule-text">{r.text}</span>}
          </span>
          <span className="tf-rule-n">
            <span className="num">{r.nodes ?? '—'}</span> items
          </span>
        </li>
      ))}
    </ul>
  )
}

// ------------------------------------------------------------------ grid

export function ScheduleGrid({
  protocol,
  states,
  selected,
  onSelect,
}: {
  protocol: Protocol
  states: Map<string, NodeState>
  selected: string | null
  onSelect: (id: string) => void
}) {
  const byCell = useMemo(() => new Map(protocol.nodes.map((n) => [`${n.visit}:${n.procedure}`, n])), [protocol])
  const groups = useMemo(() => {
    const out: { category: string; procs: Protocol['procedures'] }[] = []
    for (const p of protocol.procedures) {
      const last = out[out.length - 1]
      if (last && last.category === p.category) last.procs.push(p)
      else out.push({ category: p.category, procs: [p] })
    }
    return out
  }, [protocol])
  const rules = useMemo(() => new Map(protocol.rules.map((r) => [r.id, r])), [protocol])
  const visitIdx = useMemo(() => new Map(protocol.visits.map((v) => [v.id, v])), [protocol])
  return (
    <div className="table-scroll tf-grid-scroll">
      <table className="tf-grid">
        <thead>
          <tr>
            <th className="tf-grid-proc" scope="col">
              Procedure <span className="muted">(code)</span>
            </th>
            {protocol.visits.map((v) => (
              <th key={v.id} scope="col" className={v.kind === 'repeat' ? 'tf-col-rep' : undefined} title={`${v.label}: ${v.window}`}>
                <div className="tf-vh">{v.short}</div>
                <div className="tf-vw">{shortWindow(v)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.category} category={g.category} span={protocol.visits.length + 1}>
              {g.procs.map((p) => (
                <tr key={p.id}>
                  <th scope="row" className="tf-grid-proc">
                    <span className="tf-proc-label">{p.label}</span>
                    {p.code ? <code className="tf-code">{p.code}</code> : <span className="tf-code tf-code-none">no code</span>}
                  </th>
                  {protocol.visits.map((v) => {
                    const n = byCell.get(`${v.id}:${p.id}`)
                    if (!n) return <td key={v.id} className={v.kind === 'repeat' ? 'tf-col-rep' : undefined} />
                    const st = states.get(n.id) as NodeState
                    const r = rules.get(n.rule)
                    const vis = visitIdx.get(n.visit) as Visit
                    return (
                      <td key={v.id} className={v.kind === 'repeat' ? 'tf-col-rep' : undefined}>
                        <button
                          type="button"
                          className={`tf-cell tf-cell-${st.coverage}${st.override ? ' tf-cell-ov' : ''}${selected === n.id ? ' tf-cell-on' : ''}`}
                          aria-pressed={selected === n.id}
                          title={`${vis.label}, ${p.label}: ${st.override ? 'reviewer override' : `${n.rule} ${r?.title ?? ''}`} (${coverageLabel(st.coverage)}). ${n.reason}`}
                          onClick={() => onSelect(n.id)}
                        >
                          {n.rule}
                          {st.override && <span className="tf-ov-mark">✎</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </GroupRows>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({ category, span, children }: { category: string; span: number; children: ReactNode }) {
  return (
    <>
      <tr className="tf-grid-cat">
        <th colSpan={span} scope="rowgroup">
          {category}
        </th>
      </tr>
      {children}
    </>
  )
}

function shortWindow(v: Visit): string {
  if (v.short_window) return v.short_window
  if (v.kind === 'screening') return 'd −28 to −1'
  if (v.kind === 'treatment') return v.minus ? `d${v.day} ±${v.minus}` : `d${v.day}`
  return v.kind === 'repeat' ? 'repeats' : 'follow-up'
}

// ------------------------------------------------------------------ selected node

export function NodeDetail({
  protocol,
  node,
  state,
  line,
  onSet,
}: {
  protocol: Protocol
  node: ProtocolNode
  state: NodeState
  line: Line | null
  onSet: (id: string, c: Coverage | null) => void
}) {
  const v = protocol.visits.find((x) => x.id === node.visit) as Visit
  const p = protocol.procedures.find((x) => x.id === node.procedure) as Protocol['procedures'][number]
  const r = protocol.rules.find((x) => x.id === node.rule) as Rule
  return (
    <div className="tf-detail" aria-live="polite">
      <div className="tf-detail-head">
        <div>
          <div className="small muted">
            {v.label} · window {node.window ?? v.window}
          </div>
          <div className="strong">
            {p.label} {p.code && <code className="tf-code">{p.code}</code>}
          </div>
        </div>
        <span className={`tf-pay tf-pay-${state.coverage}`}>{coverageLabel(state.coverage)}</span>
      </div>
      <p className="small">
        <RuleChip rule={node.rule} coverage={node.coverage} /> <strong>{r.title}.</strong> {node.reason}
      </p>
      {state.override && (
        <p className="small tf-ov-note">
          Reviewer override: rule {node.rule} said {node.coverage}; this item is now {state.coverage}. The term sheet shows it as “reviewer
          override”.
        </p>
      )}
      {line && <LinePrice line={line} />}
      <div className="seg tf-seg" role="group" aria-label="Coverage label for this item">
        {(['routine', 'research'] as Coverage[]).map((c) => (
          <button
            key={c}
            type="button"
            className={`seg-btn${state.coverage === c ? ' seg-on' : ''}`}
            aria-pressed={state.coverage === c}
            onClick={() => onSet(node.id, c === node.coverage ? null : c)}
          >
            {c === 'routine' ? 'Routine (insurance)' : 'Research (sponsor)'}
          </button>
        ))}
      </div>
      {state.override && (
        <button type="button" className="btn btn-small" onClick={() => onSet(node.id, null)}>
          Reset to rule {node.rule}
        </button>
      )}
    </div>
  )
}

export function LinePrice({ line }: { line: Line }) {
  if (line.schedule === 'PFS' && line.formula)
    return (
      <p className="small tf-formula">
        Medicare at this site: <strong className="num">{usd(line.medicare_amount)}</strong> = <span className="tf-mono">{formulaText(line.formula)}</span>
      </p>
    )
  if (line.schedule === 'CLFS')
    return (
      <p className="small tf-formula">
        Lab fee schedule (national): <strong className="num">{usd(line.medicare_amount)}</strong>{' '}
        {line.placeholder && <span className="tf-ph">placeholder until the CLFS file is loaded</span>}
      </p>
    )
  if (line.schedule === 'Standard')
    return (
      <p className="small tf-formula">
        Priced from the proposed standard schedule
        {line.unit_amount !== null ? (
          <>
            : <strong className="num">{usd(line.unit_amount)}</strong>
          </>
        ) : (
          ' (billed only when research)'
        )}
      </p>
    )
  if (line.note) return <p className="small tf-formula">{line.note}</p>
  return null
}

// ------------------------------------------------------------------ coverage list

export function CoverageList({
  protocol,
  states,
  onToggle,
}: {
  protocol: Protocol
  states: Map<string, NodeState>
  onToggle: (n: ProtocolNode) => void
}) {
  const [filter, setFilter] = useState<'all' | Coverage | 'override'>('all')
  const vis = useMemo(() => new Map(protocol.visits.map((v) => [v.id, v])), [protocol])
  const keep = (n: ProtocolNode) => {
    const st = states.get(n.id)
    if (!st || filter === 'all') return true
    return filter === 'override' ? st.override : st.coverage === filter
  }
  const rows = useMemo(
    () =>
      protocol.procedures.map((p) => {
        const groups: { rule: ProtocolNode['rule']; reason: string; coverage: Coverage; nodes: ProtocolNode[] }[] = []
        for (const n of protocol.nodes.filter((x) => x.procedure === p.id)) {
          const g = groups.find((x) => x.rule === n.rule && x.reason === n.reason)
          if (g) g.nodes.push(n)
          else groups.push({ rule: n.rule, reason: n.reason, coverage: n.coverage, nodes: [n] })
        }
        return { p, groups }
      }),
    [protocol],
  )
  const shown = rows
    .map(({ p, groups }) => ({ p, groups: groups.map((g) => ({ ...g, nodes: g.nodes.filter(keep) })).filter((g) => g.nodes.length) }))
    .filter((r) => r.groups.length)
  const count = (f: typeof filter) =>
    protocol.nodes.filter((n) => {
      const st = states.get(n.id)
      return f === 'all' || (st && (f === 'override' ? st.override : st.coverage === f))
    }).length
  return (
    <div className="tf-cov">
      <div className="seg tf-cov-filter" role="group" aria-label="Filter items">
        {(
          [
            ['all', 'All items'],
            ['research', 'Sponsor pays'],
            ['routine', 'Billed to insurance'],
            ['override', 'Reviewer overrides'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className={`seg-btn${filter === k ? ' seg-on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label} <span className="tnum">({count(k)})</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="small muted">No items match this filter.</p>}
      {shown.map(({ p, groups }) => (
        <div key={p.id} className="tf-cov-row">
          <div className="tf-cov-proc">
            <span className="strong">{p.label}</span>{' '}
            {p.code ? <code className="tf-code">{p.code}</code> : <span className="tf-code tf-code-none">no code</span>}
          </div>
          <div className="tf-cov-groups">
            {groups.map((g) => (
              <div key={g.rule + g.reason} className="tf-cov-group">
                <div className="small">
                  <RuleChip rule={g.rule} coverage={g.coverage} /> {g.reason}
                </div>
                <div className="tf-vchips">
                  {g.nodes.map((n) => {
                    const st = states.get(n.id) as NodeState
                    return (
                      <button
                        key={n.id}
                        type="button"
                        className={`tf-vchip tf-vchip-${st.coverage}${st.override ? ' tf-vchip-ov' : ''}`}
                        aria-pressed={st.override}
                        title={`${vis.get(n.visit)?.label}: ${coverageLabel(st.coverage)}${st.override ? ' (reviewer override)' : ''}. Click to flip.`}
                        onClick={() => onToggle(n)}
                      >
                        {vis.get(n.visit)?.short} · {st.coverage === 'research' ? 'sponsor' : 'insurance'}
                        {st.override && ' ✎'}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
