// Schedule of assessments for the protocol-to-terms flow: visit timeline, visits x procedures grid,
// coverage list with reviewer toggles, and the selected-node detail. Illustrative schedules only.
import { useMemo, useState, type ReactNode } from 'react'
import { coverageLabel, type Coverage, type Line, type NodeState, type Protocol, type ProtocolNode, type Rule, type Visit } from '../termsFlowApi'
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
  const step = later.length > 1 ? (704 - 524) / (later.length - 1) : 0
  return (
    <div className="tf-timeline-wrap">
      <svg className="tf-timeline" viewBox="0 0 720 132" role="img" aria-label="Visit timeline: screening, 21-day cycles with windows, then repeating and follow-up visits">
        <line x1={X0 - 10} x2={X1 + 12} y1={70} y2={70} className="tf-tl-axis" />
        {scr && scr.day !== undefined && (
          <g>
            <rect x={xOf(scr.day)} y={62} width={xOf(scr.day_end ?? -1) - xOf(scr.day)} height={16} rx={3} className="tf-tl-scr" />
            <text x={(xOf(scr.day) + xOf(scr.day_end ?? -1)) / 2} y={98} className="tf-tl-label" textAnchor="middle">
              {scr.short}
            </text>
            <text x={(xOf(scr.day) + xOf(scr.day_end ?? -1)) / 2} y={112} className="tf-tl-sub" textAnchor="middle">
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
                {w > 0 && <rect x={x - w / 2} y={66} width={w} height={8} rx={2} className="tf-tl-win" />}
                <circle cx={x} cy={70} r={4.5} className="tf-tl-dot" />
                <text x={x} y={98} className="tf-tl-label" textAnchor="middle">
                  {v.short}
                </text>
                <text x={x} y={112} className="tf-tl-sub" textAnchor="middle">
                  d{v.day}
                </text>
                {img && (
                  <g>
                    <rect x={x - 13} y={34} width={26} height={16} rx={3} className="tf-tl-img" />
                    <text x={x} y={45.5} className="tf-tl-imgtext" textAnchor="middle">
                      {img.replace('Week ', 'W')}
                    </text>
                    <line x1={x} x2={x} y1={50} y2={63} className="tf-tl-tick" />
                  </g>
                )}
              </g>
            )
          })}
        <text x={X0 - 6} y={24} className="tf-tl-sub">
          Window bars: ±3 days around each Day 1. Boxes: scheduled tumor assessments.
        </text>
        <text x={497} y={74} className="tf-tl-break" textAnchor="middle">
          ⋯
        </text>
        {later.map((v, i) => {
          const x = 524 + i * step
          return (
            <g key={v.id}>
              <circle cx={x} cy={70} r={4.5} className={v.kind === 'repeat' ? 'tf-tl-rep' : 'tf-tl-dot'} />
              <text x={x} y={98} className="tf-tl-label" textAnchor="middle">
                {v.short}
              </text>
              <text x={x} y={112} className="tf-tl-sub" textAnchor="middle">
                {shortWindow(v)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
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
  if (v.kind === 'screening') return 'd −28 to −1'
  if (v.kind === 'treatment') return v.minus ? `d${v.day} ±${v.minus}` : `d${v.day}`
  if (v.id === 'CX') return 'q3w'
  if (v.id === 'TAX') return 'q6w→q9w'
  if (v.id === 'LTFU') return 'q12w'
  if (v.id === 'SFU') return '+30 d'
  return 'at stop'
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
          Reviewer override: rule {node.rule} said {node.coverage}; this node is now {state.coverage}. The term sheet
          shows it as “reviewer override”.
        </p>
      )}
      {line && <LinePrice line={line} />}
      <div className="seg tf-seg" role="group" aria-label="Coverage label for this node">
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
        Medicare at this site: <strong>{usd(line.medicare_amount)}</strong> = <span className="tf-mono">{line.formula}</span>
      </p>
    )
  if (line.schedule === 'CLFS')
    return (
      <p className="small tf-formula">
        Lab fee schedule (national): <strong>{usd(line.medicare_amount)}</strong>{' '}
        {line.placeholder && <span className="tf-ph">placeholder until the CLFS file is loaded</span>}
      </p>
    )
  if (line.schedule === 'Standard')
    return (
      <p className="small tf-formula">
        Priced from the proposed standard schedule{line.unit_amount !== null ? <>: <strong>{usd(line.unit_amount)}</strong></> : ' (billed only when research)'}
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
      <div className="seg tf-cov-filter" role="group" aria-label="Filter nodes">
        {(
          [
            ['all', 'All nodes'],
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
      {shown.length === 0 && <p className="small muted">No nodes match this filter.</p>}
      {shown.map(({ p, groups }) => (
        <div key={p.id} className="tf-cov-row">
          <div className="tf-cov-proc">
            <span className="strong">{p.label}</span> {p.code ? <code className="tf-code">{p.code}</code> : <span className="tf-code tf-code-none">no code</span>}
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
