// #dev/components: a QA page for the theme, density, hover-card and Calm building blocks, so they can be checked in
// both themes before any view uses them. Not in the tab bar; the sample text below is placeholder, not data.
// The density control here is local (<LocalDensity>): trying Simple or Detailed on this page never changes the
// app-wide choice.
import { useState } from 'react'
import { Badge, Banner, Caveat, Details, ErrorBox, Gloss, KeyFigure, Qualifier, Section, Segmented, Stat, Window } from '../components'
import { DENSITY_TOGGLE_ENABLED, DensityControl, Detailed, LocalDensity, SimpleOnly, useDensity } from '../density'
import { HoverCard, InfoTip } from '../hovercard'
import { ThemeControl, useTheme } from '../theme'
import './devComponents.css'

const TOKENS = [
  '--bg',
  '--surface',
  '--surface-2',
  '--ink',
  '--ink-2',
  '--muted',
  '--rule',
  '--rule-strong',
  '--ctl',
  '--accent',
  '--accent-soft',
  '--series-2',
  '--caution-bg',
  '--caution-ink',
  '--heat-1',
  '--heat-2',
  '--heat-3',
  '--heat-4',
  '--error-bg',
  '--ok-bg',
  '--neutral-bg',
]

const LONG =
  'A longer plain-text tooltip, to check wrapping: it should stay inside the viewport with an 8 px margin, sit below its trigger unless that would cross the bottom edge, and flip above it there.'

function RichSample({ title }: { title: string }) {
  return (
    <div className="dev-rich">
      <strong>{title}</strong>
      <table className="tbl tbl-compact">
        <tbody>
          <tr>
            <th scope="row">Row one</th>
            <td className="num">1.23</td>
          </tr>
          <tr>
            <th scope="row">Row two</th>
            <td className="num">45.6</td>
          </tr>
        </tbody>
      </table>
      <p className="small muted">Rich content is a non-modal popover: Tab from the trigger moves into it.</p>
      <a href="#dev/components">A link inside the card</a>
    </div>
  )
}

function DensityReadout() {
  const { density } = useDensity()
  return (
    <span className="small" data-qa="density-readout">
      Showing <strong>{density}</strong> on this page only · app header switch {DENSITY_TOGGLE_ENABLED ? 'on' : 'off'} (DENSITY_TOGGLE_ENABLED)
    </span>
  )
}

export default function DevComponentsView() {
  const { pref, theme } = useTheme()
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a')
  return (
    <section className="view dev">
      <div className="view-head">
        <h1>Component check</h1>
        <p className="lede">QA page for the theme, density, hover-card and Calm building blocks. It is not linked from the tab bar.</p>
      </div>

      <div className="card">
        <h2>Theme</h2>
        <div className="dev-row">
          <ThemeControl />
          <span className="small" data-qa="theme-readout">
            Preference <strong>{pref}</strong> · showing <strong>{theme}</strong>
          </span>
        </div>
        <div className="dev-swatches">
          {TOKENS.map((t) => (
            <span key={t} className="dev-swatch">
              <i style={{ background: `var(${t})` }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      <LocalDensity initial="detailed">
        <div className="dev-stack">
          <div className="card">
            <h2>Density (local to this page)</h2>
            <div className="dev-row">
              <DensityControl />
              <DensityReadout />
            </div>
            <Detailed>
              <p data-qa="detailed-only">Detailed only: this paragraph is wrapped in &lt;Detailed&gt;.</p>
            </Detailed>
            <SimpleOnly>
              <p data-qa="simple-only">Simple only: this paragraph is wrapped in &lt;SimpleOnly&gt;.</p>
            </SimpleOnly>
          </div>

          <Section
            title="Section: a claim in a few words"
            lede="One plain sentence that says what the number means, with a qualifier kept next to it."
            qualifiers={
              <p>
                <Qualifier mark="†">Placeholder qualifier</Qualifier> stays visible in Simple and Detailed.
              </p>
            }
            info="Info card behind the 2 rem button: caveats, sources and method notes that may move out of the way in Simple mode."
            figure={
              <div className="dev-figs">
                <KeyFigure value="12" label="Placeholder count" layout="inline" />
                <KeyFigure value="3.4×" label="A ratio with its qualifier" qualifier={<Qualifier tone="muted">held-out</Qualifier>} />
                <KeyFigure value="56%" label="A share" qualifier={<Qualifier mark="†">Upper bound</Qualifier>} sub="One muted context line" size="lg" />
              </div>
            }
            caption="Caption: the [always visible] qualifier for the figure sits here, in both densities."
            details={
              <>
                <p>Secondary content: shown inline under a rule in Detailed, inside the closed Details disclosure in Simple.</p>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Column</th>
                      <th scope="col" className="num">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Row</th>
                      <td className="num">0.00</td>
                    </tr>
                  </tbody>
                </table>
              </>
            }
          />
        </div>
      </LocalDensity>

      <Window title="Window" meta="meta text" aside={<a href="#dev/components">Aside link →</a>} label="Window sample">
        <p>A window: white surface, thin rule, 14 px radius, with an optional header strip.</p>
        <div className="stats">
          <Stat label="Stat label" value="1,234" sub="Stat sub-line" />
          <Stat label="Emphasised stat" value="5.6" sub="Soft accent ground" emphasis />
        </div>
        <div className="dev-row dev-gap">
          <Badge tone="warn">warn</Badge>
          <Badge tone="ok">ok</Badge>
          <Badge tone="bad">bad (caution)</Badge>
          <Badge tone="info">info</Badge>
          <Badge tone="neutral">neutral</Badge>
          <Gloss term="upper-bound">Gloss term</Gloss>
          <Gloss term="held-out" />
        </div>
        <Caveat>A caveat: a soft inset with no heavy rule.</Caveat>
        <div className="dev-row dev-gap">
          <button className="btn btn-primary">Primary</button>
          <button className="btn">Secondary</button>
          <button className="btn btn-small">Small</button>
          <button className="btn" disabled>
            Disabled
          </button>
          <Segmented
            label="Sample segmented control"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'a', label: 'First' },
              { value: 'b', label: 'Second' },
              { value: 'c', label: 'Third' },
            ]}
          />
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">Select</span>
            <select defaultValue="b">
              <option value="a">Option A</option>
              <option value="b">Option B</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Text</span>
            <input type="text" defaultValue="Text input" />
          </label>
          <label className="field">
            <span className="field-label">Date</span>
            <input type="date" defaultValue="2026-10-16" />
          </label>
        </div>
        <Details summary="Details (closed by default)">
          <p>Disclosure body.</p>
        </Details>
      </Window>

      <Banner title="Banner.">A prominent note at the top of a view (synthetic data, in development, research outputs).</Banner>
      <ErrorBox error="Failed to fetch" onRetry={() => undefined} />

      <div className="card">
        <h2>Hover cards</h2>
        <div className="dev-grid">
          <p>
            Icon tip with plain text <InfoTip label="About the plain tip" content="Plain text: role=tooltip, linked with aria-describedby." />
          </p>
          <p>
            A <HoverCard content="Plain text on a text trigger.">text trigger</HoverCard> inside a sentence.
          </p>
          <p>
            Rich card on <HoverCard content={<RichSample title="Rich card" />}>a text trigger</HoverCard>, with a link to Tab into.
          </p>
          <p>
            Long text <InfoTip label="About wrapping" content={LONG} />
          </p>
          <p>
            Section-size tip <InfoTip size="lg" label="Details: sample section" content={LONG} />
          </p>
        </div>
        <div className="dev-edge">
          <InfoTip label="Left edge tip" content="Clamped 8 px from the left edge." />
          <InfoTip label="Right edge tip" content={LONG} />
        </div>
      </div>

      <div className="card">
        <h2>Inside a horizontal scroller</h2>
        <p className="small muted">
          The box scrolls sideways (overflow: auto), like the overlap matrix; the cards are portalled to the page, so the box does not clip them. Scroll to the end for
          the right-hand tips.
        </p>
        <div className="dev-scroller" data-qa="scroller">
          <div className="dev-scroller-inner">
            <span>
              Start <InfoTip label="Scroller start tip" content="Inside the scroller, at its start." />
            </span>
            <span>
              Middle <HoverCard content={<RichSample title="Rich card in the scroller" />}>rich trigger</HoverCard>
            </span>
            <span>
              End <InfoTip label="Scroller end tip" content={LONG} />
            </span>
          </div>
        </div>
      </div>

      {/* Fixed to the bottom-right corner, so a scroller-held tip sits at both viewport edges at any window size. */}
      <div className="dev-dock">
        <span className="small muted">Edge dock</span>
        <div className="dev-dock-scroller" data-qa="dock">
          <div className="dev-dock-inner">
            <InfoTip label="Dock start tip" content="In the edge dock's scroller, at its start." />
            <InfoTip label="Dock end tip" content={LONG} />
          </div>
        </div>
      </div>
    </section>
  )
}
